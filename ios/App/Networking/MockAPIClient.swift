import Foundation

/// In-memory `APIClient` for previews, unit tests and UI tests (`-UITestMockAPI`).
/// Mutations persist for the lifetime of the actor. Delays and failures are configurable
/// so loading and error states can be exercised.
actor MockAPIClient: APIClient {
    struct Behavior: Sendable {
        var delay: Duration = LaunchConfiguration.defaultDelay
        /// Every call throws `APIError.network` after the delay.
        var failNetwork = false
        /// Throw this for specific endpoints, keyed by method name (e.g. "removeItem").
        var failures: [String: APIError] = [:]
        /// Calls whose first N attempts fail (key = method name), then succeed. Tests the retry button.
        var failFirst: [String: Int] = [:]
        /// Per-method delay overriding `delay` (key = method name), e.g. a slow remove.
        var delays: [String: Duration] = [:]
        /// `removeItem` throws this for `thrown_out` only (`-UITestTossFails`).
        var failThrownOut: APIError?
        /// Every authenticated call signs the user out and throws `unauthorized` (`-UITestExpiredSession`).
        var expiredSession = false
        /// `fromPhoto` finds nothing (`-UITestPhotoNone`).
        var photoFindsNothing = false
        /// `impact` returns zeros (the `empty` seed): the Impact empty state.
        var emptyImpact = false
    }

    private(set) var behavior: Behavior
    var items: [Item]
    let auth: AuthStore?
    var signedInUser: User?
    private var callCounts: [String: Int] = [:]
    var nextID = 1
    /// One `remove` event per item removed through this mock (keyed by item id), the way the backend writes
    /// them. `impact(range:)` adds them to the fixture baseline; a restore deletes the item's entry, so Undo
    /// leaves Impact exactly as it was. Actor-isolated like `items`.
    var impactEvents: [String: MockImpactEvent] = [:]
    /// Friends, groups, Food Pantry, requests and people (see `MockSocialFixtures.swift`).
    var social: MockSocialState

    init(fixture: MockFixture = .fridge, behavior: Behavior = Behavior(), auth: AuthStore? = nil,
         signedIn: Bool = false, now: Date = Date()) {
        self.items = MockData.items(for: fixture, now: now)
        self.social = MockData.social(for: fixture, now: now)
        self.behavior = behavior
        self.auth = auth
        self.signedInUser = signedIn ? MockData.priya : nil
    }

    func setBehavior(_ b: Behavior) { behavior = b }
    func setFailNetwork(_ on: Bool) { behavior.failNetwork = on }
    func setDelay(_ d: Duration) { behavior.delay = d }
    func setFailure(_ error: APIError?, for method: String) { behavior.failures[method] = error }
    func calls(to method: String) -> Int { callCounts[method, default: 0] }
    func currentItems() -> [Item] { items }

    func gate(_ method: String, authenticated: Bool = true) async throws {
        callCounts[method, default: 0] += 1
        let delay = behavior.delays[method] ?? behavior.delay
        if delay > .zero { try await Task.sleep(for: delay) }
        if behavior.failNetwork { throw APIError.network("The Internet connection appears to be offline.") }
        if let remaining = behavior.failFirst[method], remaining > 0 {
            behavior.failFirst[method] = remaining - 1
            throw APIError.network("Simulated failure")
        }
        if let e = behavior.failures[method] { throw e }
        if authenticated, behavior.expiredSession {
            signedInUser = nil
            await auth?.expireSession()
            throw APIError.unauthorized
        }
        if authenticated, auth != nil, signedInUser == nil, await auth?.isSignedIn == false { throw APIError.unauthorized }
    }

    func validation(_ message: String) -> APIError { .server(status: 400, code: "validation_error", message: message) }
    func notFound(_ what: String = "Item") -> APIError { .server(status: 404, code: "not_found", message: "\(what) not found.") }
    func conflict(_ code: String, _ message: String) -> APIError { .server(status: 409, code: code, message: message) }
    func forbidden(_ message: String = "Not allowed.") -> APIError { .server(status: 403, code: "forbidden", message: message) }

    // MARK: Auth

    func signup(email: String, password: String, displayName: String) async throws -> AuthSession {
        try await gate("signup", authenticated: false)
        guard password.count >= 8 else { throw validation("Password must be at least 8 characters.") }
        if email.lowercased() == "taken@example.com" {
            throw APIError.server(status: 409, code: "email_taken", message: "That email is already registered.")
        }
        let user = User(id: "user-new", email: email.lowercased(), displayName: displayName, createdAt: Date())
        return await finishAuth(AuthSession(token: "mock-token", user: user))
    }

    /// Any credentials work except password `wrong-password` (-> 401 invalid_credentials).
    func login(email: String, password: String) async throws -> AuthSession {
        try await gate("login", authenticated: false)
        if password == "wrong-password" {
            throw APIError.server(status: 401, code: "invalid_credentials", message: "Wrong email or password.")
        }
        let user = email.lowercased() == MockData.priya.email ? MockData.priya
            : User(id: "user-\(abs(email.hashValue))", email: email.lowercased(), displayName: "Friend", createdAt: nil)
        return await finishAuth(AuthSession(token: "mock-token", user: user))
    }

    private func finishAuth(_ s: AuthSession) async -> AuthSession {
        signedInUser = s.user
        await auth?.signIn(s)
        return s
    }

    func health() async throws -> Bool {
        try await gate("health", authenticated: false)
        return true
    }

    func me() async throws -> Me {
        try await gate("me")
        return Me(user: signedInUser ?? MockData.priya, hasPassword: true, providers: [])
    }

    /// `new-google-user` creates an account (`created: true`); any other non-empty token signs in Priya.
    func googleSignIn(idToken: String) async throws -> GoogleAuthResult {
        try await gate("googleSignIn", authenticated: false)
        guard !idToken.isEmpty else { throw validation("id_token is required.") }
        if idToken == "new-google-user" {
            let user = User(id: "user-google-new", email: "new.cougar@gmail.com", displayName: "New Cougar", createdAt: Date())
            return GoogleAuthResult(session: await finishAuth(AuthSession(token: "mock-token", user: user)), created: true)
        }
        return GoogleAuthResult(session: await finishAuth(AuthSession(token: "mock-token", user: MockData.priya)), created: false)
    }

    func deleteAccount() async throws {
        try await gate("deleteAccount")
        items.removeAll()
        impactEvents.removeAll()
        signedInUser = nil
        await auth?.signOut()
    }

    // MARK: Items

    private func sorted(_ list: [Item]) -> [Item] {
        list.sorted {
            switch ($0.predictedExpiry, $1.predictedExpiry) {
            case let (a?, b?) where a != b: return a < b
            case (nil, _?): return false
            case (_?, nil): return true
            default: return ($0.addedAt ?? .distantPast) < ($1.addedAt ?? .distantPast)
            }
        }
    }

    func listItems(storage: Storage?, groupBy: ItemGrouping?) async throws -> ItemListing {
        try await gate("listItems")
        let active = sorted(items.filter { !$0.isRemoved && (storage == nil || $0.storage == storage) })
        guard groupBy != nil else { return .flat(active) }
        let sections = FoodGroup.allCases.compactMap { g -> ItemSection? in
            let inGroup = active.filter { $0.foodGroup == g }
            return inGroup.isEmpty ? nil : ItemSection(foodGroup: g, items: inGroup)
        }
        return .grouped(sections)
    }

    func createItems(_ new: [NewItem]) async throws -> [Item] {
        try await gate("createItems")
        guard (1...100).contains(new.count) else { throw validation("Send between 1 and 100 items.") }
        let cal = Calendar.current
        let created = new.map { n -> Item in
            defer { nextID += 1 }
            let category = n.category ?? .other
            let days = [FoodCategory.meat: 3, .seafood: 2, .produceLeafy: 5, .produceHardy: 10, .dairy: 10,
                        .eggs: 21, .bakery: 5, .leftovers: 4, .pantryDry: 180, .frozen: 120][category] ?? 7
            let expiry = n.predictedExpiry.flatMap { APIDate.parse($0) }
                ?? cal.date(byAdding: .day, value: days, to: cal.startOfDay(for: Date()))
            return Item(id: "item-new-\(nextID)", ownerId: signedInUser?.id ?? MockData.priya.id, groupId: n.groupId, name: n.name,
                        category: category, foodGroup: n.foodGroup ?? .other, storage: n.storage ?? .fridge,
                        quantity: n.quantity ?? 1, unit: n.unit ?? "piece", estWeightKg: n.estWeightKg ?? 0.3,
                        estPrice: n.estPrice, source: n.source ?? "manual", addedAt: Date(), predictedExpiry: expiry,
                        expirySource: n.predictedExpiry == nil ? "default" : (n.expirySource ?? .user).rawValue,
                        removedAt: nil, outcome: nil, wasteReason: nil, removedAfterExpiry: nil,
                        freshness: n.freshness, freshnessCheckedAt: n.freshness == nil ? nil : Date(),
                        confidence: n.confidence, share: nil)
        }
        items.append(contentsOf: created)
        return created
    }

    func patchItem(id: String, _ p: ItemPatch) async throws -> Item {
        try await gate("patchItem")
        guard let i = items.firstIndex(where: { $0.id == id && !$0.isRemoved }) else { throw notFound() }
        if let v = p.name { items[i].name = v }
        if let v = p.quantity { items[i].quantity = v }
        if let v = p.unit { items[i].unit = v }
        if let v = p.storage { items[i].storage = v }
        if let v = p.category { items[i].category = v }
        if let v = p.foodGroup { items[i].foodGroup = v }
        if let v = p.predictedExpiry { items[i].predictedExpiry = APIDate.parse(v); items[i].expirySource = "user" }
        if let v = p.estPrice { items[i].estPrice = v }
        if let v = p.estWeightKg { items[i].estWeightKg = v }
        if p.clearFreshness { items[i].freshness = nil; items[i].freshnessCheckedAt = nil }
        else if let v = p.freshness { items[i].freshness = v; items[i].freshnessCheckedAt = Date() }
        return items[i]
    }

    func removeItem(id: String, outcome: RemoveOutcome, wasteReason: WasteReason?, recipient: RecipientChoice) async throws -> Item {
        try await gate("removeItem")
        if outcome == .thrownOut, let e = behavior.failThrownOut { throw e }
        if outcome == .thrownOut && wasteReason == nil { throw validation("waste_reason is required when thrown_out.") }
        if outcome != .thrownOut && wasteReason != nil { throw validation("waste_reason is only allowed when thrown_out.") }
        if outcome != .donated && recipient != .default { throw validation("recipient_id is only allowed when donated.") }
        guard let i = items.firstIndex(where: { $0.id == id }) else { throw notFound() }
        if items[i].isRemoved { throw APIError.server(status: 409, code: "already_removed", message: "Already removed.") }
        let recipientId = try resolveRecipient(recipient, outcome: outcome, itemIndexes: [i])
        applyRemoval(at: i, outcome: outcome, wasteReason: wasteReason, now: Date(), recipientId: recipientId)
        return items[i]
    }

    /// Soft-deletes `items[i]`; a donated removal fulfils the item's open listing (docs/API.md).
    /// Mirrors the backend's recipient rules: `.default` is the claimer of an open listing, `.none` nobody,
    /// `.user` must be someone reachable (not yourself).
    func resolveRecipient(_ choice: RecipientChoice, outcome: RemoveOutcome, itemIndexes: [Int]) throws -> String?? {
        guard outcome == .donated else { return nil }
        switch choice {
        case .default: return nil
        case .none: return .some(nil)
        case .user(let uid):
            if uid == (signedInUser ?? MockData.priya).id { throw validation("You can't give food to yourself.") }
            guard social.people.contains(where: { $0.id == uid }) else { throw notFound("Recipient") }
            return .some(uid)
        }
    }

    func applyRemoval(at i: Int, outcome: RemoveOutcome, wasteReason: WasteReason?, now: Date, recipientId: String?? = nil) {
        items[i].removedAt = now
        items[i].outcome = outcome
        items[i].wasteReason = wasteReason
        items[i].removedAfterExpiry = items[i].predictedExpiry.map { Calendar.current.startOfDay(for: now) > $0 }
        impactEvents[items[i].id] = MockImpact.event(for: items[i], outcome: outcome, wasteReason: wasteReason, at: now)
        if outcome == .donated, let share = items[i].share, share.status == .open {
            items[i].share = ItemShare(id: share.id, status: .fulfilled, claimedBy: share.claimedBy, audience: share.audience)
            if let l = social.listings.firstIndex(where: { $0.id == share.id }) {
                social.listings[l].status = .fulfilled
                social.listings[l].fulfilledAt = now
                switch recipientId {
                case .none: social.listings[l].recipientId = social.listings[l].claimedBy
                case .some(let r): social.listings[l].recipientId = r
                }
            }
        }
    }

    func restoreItem(id: String) async throws -> Item {
        try await gate("restoreItem")
        guard let i = items.firstIndex(where: { $0.id == id }) else { throw notFound() }
        guard let removedAt = items[i].removedAt else { throw APIError.notRemoved }
        if Date().timeIntervalSince(removedAt) > 600 { throw APIError.restoreWindowExpired }
        applyRestore(at: i)
        return items[i]
    }

    func applyRestore(at i: Int) {
        // Undo reopens a listing that the removal fulfilled (claimed_by kept).
        if items[i].outcome == .donated, let share = items[i].share, share.status == .fulfilled {
            items[i].share = ItemShare(id: share.id, status: .open, claimedBy: share.claimedBy, audience: share.audience)
            if let l = social.listings.firstIndex(where: { $0.id == share.id }) {
                social.listings[l].status = .open
                social.listings[l].fulfilledAt = nil
                social.listings[l].recipientId = nil
            }
        }
        items[i].removedAt = nil; items[i].outcome = nil; items[i].wasteReason = nil; items[i].removedAfterExpiry = nil
        impactEvents[items[i].id] = nil  // the backend deletes the item's remove event on restore
    }

    func removeBatch(ids: [String], outcome: RemoveOutcome, recipient: RecipientChoice) async throws -> [Item] {
        try await gate("removeBatch")
        guard (1...100).contains(ids.count), Set(ids).count == ids.count else { throw validation("Send 1-100 unique item ids.") }
        guard outcome != .thrownOut else { throw validation("thrown_out is not allowed in a batch.") }
        guard recipient == .default || outcome == .donated else { throw validation("recipient_id is only allowed when donated.") }
        let indexes = try ids.map { id -> Int in
            guard let i = items.firstIndex(where: { $0.id == id }) else { throw notFound() }
            return i
        }
        if indexes.contains(where: { items[$0].isRemoved }) { throw conflict("already_removed", "Already removed.") }
        let now = Date()
        let recipientId = try resolveRecipient(recipient, outcome: outcome, itemIndexes: indexes)
        for i in indexes { applyRemoval(at: i, outcome: outcome, wasteReason: nil, now: now, recipientId: recipientId) }
        return indexes.map { items[$0] }
    }

    func restoreBatch(ids: [String]) async throws -> [Item] {
        try await gate("restoreBatch")
        guard (1...100).contains(ids.count), Set(ids).count == ids.count else { throw validation("Send 1-100 unique item ids.") }
        let indexes = try ids.map { id -> Int in
            guard let i = items.firstIndex(where: { $0.id == id }) else { throw notFound() }
            return i
        }
        if indexes.contains(where: { !items[$0].isRemoved }) { throw APIError.notRemoved }
        if indexes.contains(where: { Date().timeIntervalSince(items[$0].removedAt ?? Date()) > 600 }) { throw APIError.restoreWindowExpired }
        for i in indexes { applyRestore(at: i) }
        return indexes.map { items[$0] }
    }

    // MARK: Adding food

    func fromPhoto(imageData: Data, mode: PhotoMode) async throws -> CandidatesResponse {
        try await gate("fromPhoto")
        if behavior.photoFindsNothing { return CandidatesResponse(candidates: [], source: "mock") }
        let all = MockData.candidates()
        return CandidatesResponse(candidates: mode == .single ? Array(all.prefix(1)) : all, source: "mock")
    }

    func parseText(_ text: String) async throws -> [Candidate] {
        try await gate("parseText")
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw validation("text is required.") }
        let names = text.replacingOccurrences(of: " and ", with: ",").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let expiry = Calendar.current.date(byAdding: .day, value: 7, to: Calendar.current.startOfDay(for: Date()))
        return names.map {
            Candidate(name: $0.capitalized, category: .other, foodGroup: .other, confidence: nil, freshness: nil, bbox: nil,
                      storage: .fridge, quantity: 1, unit: "piece", estPrice: nil, predictedExpiry: expiry, expirySource: "default")
        }
    }

    func fromReceipt(imageData: Data) async throws -> ReceiptResponse {
        try await gate("fromReceipt")
        if behavior.photoFindsNothing { return ReceiptResponse(candidates: [], total: nil, categorizedBy: "heuristic") }
        return MockData.receipt()
    }

    func barcode(_ code: String) async throws -> BarcodeResult {
        try await gate("barcode")
        guard (6...14).contains(code.count), code.allSatisfy(\.isNumber) else { throw validation("Barcode must be 6-14 digits.") }
        guard let r = MockData.barcode(code) else { throw notFound("Product") }
        return r
    }

    // MARK: Insights

    func impact(range: ImpactRange) async throws -> Impact {
        try await gate("impact")
        // Fixture baseline plus this session's removals (restores already dropped theirs).
        let base = behavior.emptyImpact ? MockData.emptyImpact(range: range) : MockData.impact(range: range)
        return MockImpact.apply(Array(impactEvents.values), to: base, range: range)
    }

    func tips() async throws -> [Tip] { try await gate("tips"); return MockData.tips }

    func recipesSuggest(maxResults: Int?, dietary: [String]?) async throws -> [Recipe] {
        try await gate("recipesSuggest")
        return Array(MockData.recipes.prefix(maxResults ?? 3))
    }
}
