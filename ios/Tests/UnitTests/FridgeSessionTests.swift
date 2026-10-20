import XCTest
@testable import FoodWasteReducer

/// One-shot gate: the first caller of `wait()` suspends until `open()`.
actor SessionGate {
    private var opened = false
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var waiting = false
    func wait() async {
        if opened { return }
        waiting = true
        await withCheckedContinuation { waiter = $0 }
    }
    func open() {
        opened = true
        waiter?.resume(); waiter = nil
        throwing?.resume(); throwing = nil
    }

    // Cancellation-aware wait, like URLSession: a cancelled task leaves the gate by throwing, and the
    // call never reaches the server. Used to prove the model does NOT cancel in-flight operations.
    private var throwing: CheckedContinuation<Void, Error>?
    private(set) var sawCancellation = false
    func waitCancellable() async throws {
        if opened { return }
        waiting = true
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { sawCancellation = true; c.resume(throwing: CancellationError()); return }
                throwing = c
            }
        } onCancel: {
            Task { await self.cancelWaiter() }
        }
    }
    private func cancelWaiter() {
        sawCancellation = true
        throwing?.resume(throwing: CancellationError()); throwing = nil
    }
}

/// Forwards to whichever Mock is `current` when a call STARTS (A = fridge fixture, B = long fixture:
/// disjoint item ids). Optional one-shot gates hold the next list / remove / restore call.
actor SwitchAPIClient: APIClient {
    private(set) var current: MockAPIClient
    private(set) var lists = 0
    /// Calls that actually reached a server (a mock), in order.
    private(set) var removeCalls: [String] = []
    private(set) var restoreCalls: [String] = []
    private(set) var batchRestoreCalls: [[String]] = []
    var listGate: SessionGate?
    var removeGate: SessionGate?
    var restoreGate: SessionGate?
    /// One-shot, captured when the call STARTS (so a later call by another user is not affected).
    var removeError: APIError?
    var restoreError: APIError?
    /// When true the gates throw if the calling task is cancelled (like URLSession).
    var cancellable = false
    init(_ start: MockAPIClient) { current = start }
    func switchTo(_ m: MockAPIClient) { current = m }
    func hold(list: SessionGate? = nil, remove: SessionGate? = nil, restore: SessionGate? = nil, cancellable: Bool = false) {
        listGate = list; removeGate = remove; restoreGate = restore; self.cancellable = cancellable
    }
    func fail(remove: APIError? = nil, restore: APIError? = nil) { removeError = remove; restoreError = restore }

    private func pass(_ g: SessionGate) async throws {
        if cancellable { try await g.waitCancellable() } else { await g.wait() }
    }

    func listItems(storage: Storage?, groupBy: ItemGrouping?) async throws -> ItemListing {
        lists += 1
        let mock = current
        if let g = listGate { listGate = nil; try await pass(g) }
        return try await mock.listItems(storage: storage, groupBy: groupBy)
    }
    func removeItem(id: String, outcome: RemoveOutcome, wasteReason: WasteReason?, recipient: RecipientChoice) async throws -> Item {
        let mock = current
        let err = removeError; removeError = nil
        if let g = removeGate { removeGate = nil; try await pass(g) }
        if let e = err { throw e }
        removeCalls.append(id)
        return try await mock.removeItem(id: id, outcome: outcome, wasteReason: wasteReason, recipient: recipient)
    }
    func restoreItem(id: String) async throws -> Item {
        let mock = current
        let err = restoreError; restoreError = nil
        if let g = restoreGate { restoreGate = nil; try await pass(g) }
        if let e = err { throw e }
        restoreCalls.append(id)
        return try await mock.restoreItem(id: id)
    }
    func restoreBatch(ids: [String]) async throws -> [Item] { batchRestoreCalls.append(ids); return try await current.restoreBatch(ids: ids) }
    func signup(email: String, password: String, displayName: String) async throws -> AuthSession { try await current.signup(email: email, password: password, displayName: displayName) }
    func login(email: String, password: String) async throws -> AuthSession { try await current.login(email: email, password: password) }
    func deleteAccount() async throws { try await current.deleteAccount() }
    func createItems(_ items: [NewItem]) async throws -> [Item] { try await current.createItems(items) }
    func patchItem(id: String, _ patch: ItemPatch) async throws -> Item { try await current.patchItem(id: id, patch) }
    func health() async throws -> Bool { try await current.health() }
    func me() async throws -> Me { try await current.me() }
    func googleSignIn(idToken: String) async throws -> GoogleAuthResult { try await current.googleSignIn(idToken: idToken) }
    func removeBatch(ids: [String], outcome: RemoveOutcome, recipient: RecipientChoice) async throws -> [Item] { try await current.removeBatch(ids: ids, outcome: outcome, recipient: recipient) }
    func fromReceipt(imageData: Data) async throws -> ReceiptResponse { try await current.fromReceipt(imageData: imageData) }
    func barcode(_ code: String) async throws -> BarcodeResult { try await current.barcode(code) }
    func listShares() async throws -> [PantryListing] { try await current.listShares() }
    func createShare(itemId: String, groupId: String?) async throws -> Listing { try await current.createShare(itemId: itemId, groupId: groupId) }
    func cancelShare(id: String) async throws -> Listing { try await current.cancelShare(id: id) }
    func claimShare(id: String) async throws -> Listing { try await current.claimShare(id: id) }
    func listRequests() async throws -> [HelpRequest] { try await current.listRequests() }
    func listMyRequests() async throws -> [HelpRequest] { try await current.listMyRequests() }
    func createRequest(text: String, friends: Bool, groupIds: [String]) async throws -> HelpRequest { try await current.createRequest(text: text, friends: friends, groupIds: groupIds) }
    func fulfilRequest(id: String) async throws -> HelpRequest { try await current.fulfilRequest(id: id) }
    func cancelRequest(id: String) async throws -> HelpRequest { try await current.cancelRequest(id: id) }
    func listFriends() async throws -> FriendsResponse { try await current.listFriends() }
    func requestFriend(email: String) async throws -> Friend { try await current.requestFriend(email: email) }
    func acceptFriend(userId: String) async throws -> Friend { try await current.acceptFriend(userId: userId) }
    func declineFriend(userId: String) async throws { try await current.declineFriend(userId: userId) }
    func removeFriend(userId: String) async throws { try await current.removeFriend(userId: userId) }
    func friendCode() async throws -> FriendCodeInfo { try await current.friendCode() }
    func addFriend(code: String) async throws -> FriendAddResult { try await current.addFriend(code: code) }
    func share(itemId: String, audience: ShareAudience, pickup: Pickup?) async throws -> Listing { try await current.share(itemId: itemId, audience: audience, pickup: pickup) }
    func updatePickup(listingId: String, pickup: Pickup?) async throws -> Listing { try await current.updatePickup(listingId: listingId, pickup: pickup) }
    func listGroups() async throws -> [SharingGroup] { try await current.listGroups() }
    func createGroup(name: String) async throws -> SharingGroup { try await current.createGroup(name: name) }
    func joinGroup(inviteCode: String) async throws -> SharingGroup { try await current.joinGroup(inviteCode: inviteCode) }
    func leaveGroup(id: String) async throws { try await current.leaveGroup(id: id) }
    func groupDetail(id: String) async throws -> GroupDetail { try await current.groupDetail(id: id) }
    func groupPantry(id: String) async throws -> [PantryItem] { try await current.groupPantry(id: id) }
    func reachablePeople(itemId: String?) async throws -> [Person] { try await current.reachablePeople(itemId: itemId) }
    func fromPhoto(imageData: Data, mode: PhotoMode) async throws -> CandidatesResponse { try await current.fromPhoto(imageData: imageData, mode: mode) }
    func parseText(_ text: String) async throws -> [Candidate] { try await current.parseText(text) }
    func impact(range: ImpactRange) async throws -> Impact { try await current.impact(range: range) }
    func tips() async throws -> [Tip] { try await current.tips() }
    func recipesSuggest(maxResults: Int?, dietary: [String]?) async throws -> [Recipe] { try await current.recipesSuggest(maxResults: maxResults, dietary: dietary) }
}

@MainActor
final class FridgeSessionTests: XCTestCase {
    private var haptics: RecordingHaptics!
    private var savedProvider: HapticsProviding!
    override func setUp() async throws {
        savedProvider = Haptics.provider
        haptics = RecordingHaptics()
        Haptics.provider = haptics
    }
    override func tearDown() async throws { Haptics.provider = savedProvider }

    private let userA = User(id: "user-a", email: "a@example.com", displayName: "A", createdAt: nil)
    private let userB = User(id: "user-b", email: "b@example.com", displayName: "B", createdAt: nil)
    private func mock(_ f: MockFixture, _ b: MockAPIClient.Behavior = .init(delay: .zero)) -> MockAPIClient { MockAPIClient(fixture: f, behavior: b) }

    private func make(_ b: MockAPIClient.Behavior = .init(delay: .zero)) -> (FridgeModel, SwitchAPIClient, MockAPIClient, MockAPIClient) {
        let a = mock(.fridge, b), bb = mock(.long)
        let api = SwitchAPIClient(a)
        return (FridgeModel(api: api), api, a, bb)
    }
    private func ids(_ m: FridgeModel, _ s: Storage = .fridge) -> [String] {
        guard case .content(let secs) = m.state(for: s) else { return [] }
        return secs.flatMap { $0.items.map(\.id) }
    }
    private func item(_ m: FridgeModel, _ id: String) -> Item {
        guard case .content(let secs) = m.state(for: .fridge) else { fatalError("no content") }
        return secs.flatMap(\.items).first { $0.id == id }!
    }
    private func isUnauthorized(_ m: FridgeModel, _ s: Storage) -> Bool {
        if case .error(let e) = m.state(for: s) { return (e as? APIError) == .unauthorized }
        return false
    }
    private func isLoading(_ m: FridgeModel, _ s: Storage) -> Bool {
        if case .loading = m.state(for: s) { return true }
        return false
    }
    private func until(_ cond: () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        let end = Date().addingTimeInterval(3)
        while Date() < end { if await cond() { return }; try? await Task.sleep(for: .milliseconds(20)) }
        XCTFail("condition not met", file: file, line: line)
    }
    private func settle() async { try? await Task.sleep(for: .milliseconds(300)) }

    // MARK: Sign-out and sign-in

    func testSignOutShowsUnauthorizedForEveryStorageAndClearsToastAndBanner() async {
        let (m, _, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        XCTAssertNotNil(m.toast)
        await m.sessionChanged(from: userA, to: nil)
        for s in Storage.allCases { XCTAssertTrue(isUnauthorized(m, s), "\(s) should show the unauthorized error") }
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner)
        XCTAssertTrue(ids(m).isEmpty, "no stale rows after sign-out")
    }

    func testSignOutWithPendingToastNotYetShownLeavesNoToast() async {
        let (m, _, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)   // sheet still up
        await m.sessionChanged(from: userA, to: nil)
        m.showPendingToast()   // the sheet's onDismiss fires after sign-out
        XCTAssertNil(m.toast, "pendingToast must be dropped by sign-out")
    }

    func testSignInAfterSignOutLoadsContentWithOneStaggerRestart() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        XCTAssertEqual(m.staggerRestarts, 1)
        await m.sessionChanged(from: userA, to: nil)
        XCTAssertEqual(m.staggerRestarts, 1, "sign-out itself must not stagger")
        await m.sessionChanged(from: nil, to: userA)
        XCTAssertEqual(ids(m).count, 8)
        XCTAssertEqual(m.staggerRestarts, 2, "exactly one restart for the new content")
        let lists = await api.lists
        XCTAssertEqual(lists, 2)
    }

    /// Sign-out marks every storage unauthorized; sign-in must clear that for the storages it
    /// does not reload (loadIfNeeded skips a storage that has an error).
    func testSignInAfterSignOutDoesNotLeaveOtherStoragesStuckUnauthorized() async {
        let (m, _, _, _) = make()
        await m.loadIfNeeded(.fridge)
        await m.sessionChanged(from: userA, to: nil)
        await m.sessionChanged(from: nil, to: userA)
        XCTAssertFalse(isUnauthorized(m, .pantry))
        await m.loadIfNeeded(.pantry)
        XCTAssertFalse(isUnauthorized(m, .pantry), "selecting Pantry after sign-in must load, not show unauthorized")
    }

    // MARK: Different user

    func testSwitchUserDropsOldItemsLoadsNewAndLeavesOtherStoragesUnloaded() async {
        let (m, api, _, b) = make()
        await m.loadIfNeeded(.fridge)
        await m.loadIfNeeded(.pantry)
        XCTAssertTrue(ids(m).contains("item-chicken"))
        let before = await api.lists
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertFalse(ids(m).contains(where: { !$0.hasPrefix("item-long-") }), "no row from user A: \(ids(m))")
        XCTAssertEqual(ids(m).count, 36)
        XCTAssertTrue(isLoading(m, .pantry), "pantry cache dropped and not reloaded until selected")
        XCTAssertTrue(isLoading(m, .freezer))
        let after = await api.lists
        XCTAssertEqual(after - before, 1, "only the visible storage reloads")
        XCTAssertEqual(m.staggerRestarts, 2, "A's first load + B's first load")
        XCTAssertNil(m.banner)
    }

    func testSwitchUserWhileOnPantryReloadsThePantry() async {
        let (m, api, _, b) = make()
        m.storage = .pantry
        await m.loadIfNeeded(.pantry)
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        guard case .empty = m.state(for: .pantry) else { return XCTFail("B's pantry is empty (long fixture is all fridge): \(m.state(for: .pantry))") }
        XCTAssertTrue(isLoading(m, .fridge))
    }

    func testSwitchUserClearsBannerAndRemovalBookkeeping() async {
        var beh = MockAPIClient.Behavior(delay: .zero); beh.failures["removeItem"] = .network("offline")
        let (m, _, a, b) = make(beh)
        _ = a
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        await until { m.banner != nil }
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertNil(m.banner)
        _ = b
    }

    // MARK: Same user, new token

    func testTokenRefreshKeepsItemsNoRestaggerNoRefetch() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        await m.sessionChanged(from: userA, to: userA)
        XCTAssertEqual(ids(m), before)
        XCTAssertEqual(m.staggerRestarts, 1)
        let lists = await api.lists
        XCTAssertEqual(lists, 1, "no refetch when content is already shown")
    }

    func testTokenRefreshClearsErrorAndReloads() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failFirst["listItems"] = 1
        let (m, _, _, _) = make(b)
        await m.loadIfNeeded(.fridge)
        guard case .error = m.state(for: .fridge) else { return XCTFail("first load should fail") }
        await m.sessionChanged(from: userA, to: userA)
        XCTAssertEqual(ids(m).count, 8)
        XCTAssertEqual(m.staggerRestarts, 1)
    }

    func testTokenRefreshClearsErrorOnOtherStorage() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failFirst["listItems"] = 1
        let (m, _, _, _) = make(b)
        await m.loadIfNeeded(.pantry)       // fails
        await m.loadIfNeeded(.fridge)       // ok
        guard case .error = m.state(for: .pantry) else { return XCTFail("pantry should be in error") }
        await m.sessionChanged(from: userA, to: userA)
        XCTAssertTrue(isLoading(m, .pantry), "error cleared so the next selection retries")
        XCTAssertEqual(ids(m).count, 8)
    }

    /// The view feeds the model whole sessions (user + token): the same user with a NEW token is a
    /// token refresh, an identical session is a no-op.
    func testSessionOverloadTokenRefreshKeepsRowsNoRefetch() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        let gen = m.generation
        await m.sessionChanged(fromSession: AuthSession(token: "tok-1", user: userA), toSession: AuthSession(token: "tok-2", user: userA))
        XCTAssertEqual(ids(m), before, "rows stay on a token refresh")
        XCTAssertEqual(m.generation, gen, "same user: in-flight work is NOT invalidated")
        XCTAssertEqual(m.staggerRestarts, 1)
        let lists = await api.lists
        XCTAssertEqual(lists, 1, "no refetch when content is already shown (original 9997699 behaviour)")
    }

    func testSessionOverloadIdenticalSessionIsNoOp() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let s = AuthSession(token: "tok-1", user: userA)
        await m.sessionChanged(fromSession: s, toSession: s)
        let lists = await api.lists
        XCTAssertEqual(lists, 1)
        XCTAssertEqual(ids(m).count, 8)
    }

    func testSessionOverloadSameUserNewTokenAfterSignInErrorRecovers() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failFirst["listItems"] = 1
        let (m, _, _, _) = make(b)
        await m.loadIfNeeded(.fridge)
        guard case .error = m.state(for: .fridge) else { return XCTFail("first load should fail") }
        await m.sessionChanged(fromSession: AuthSession(token: "old", user: userA), toSession: AuthSession(token: "new", user: userA))
        XCTAssertEqual(ids(m).count, 8)
    }

    func testDifferentUserAndSignOutBumpGenerationButTokenRefreshDoesNot() async {
        let (m, _, _, b) = make()
        await m.loadIfNeeded(.fridge)
        let g0 = m.generation
        await m.sessionChanged(from: userA, to: userA)
        XCTAssertEqual(m.generation, g0)
        await m.sessionChanged(from: nil, to: nil)
        XCTAssertEqual(m.generation, g0)
        await m.sessionChanged(from: userA, to: nil)
        XCTAssertEqual(m.generation, g0 + 1)
        await m.sessionChanged(from: nil, to: userB)
        XCTAssertEqual(m.generation, g0 + 2)
        _ = b
    }

    /// A token refresh must not discard an in-flight remove: the generation is unchanged, so its
    /// failure still rolls the row back and its success still leaves the toast.
    func testRemoveInFlightSurvivesTokenRefresh() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate)
        await api.fail(remove: .network("offline"))
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gate.waiting }
        await m.sessionChanged(from: userA, to: userA)
        await gate.open()
        await until { m.banner != nil }
        XCTAssertTrue(ids(m).contains("item-chicken"), "the failed remove still rolls back after a token refresh")
    }

    func testSessionNilToNilIsNoOp() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        await m.sessionChanged(from: nil, to: nil)
        XCTAssertEqual(ids(m).count, 8)
        let lists = await api.lists
        XCTAssertEqual(lists, 1)
    }

    // MARK: Races

    func testUserSwitchDuringSlowLoadDiscardsOldResult() async {
        let (m, api, _, b) = make()
        let gate = SessionGate()
        await api.hold(list: gate)
        let slow = Task { await m.loadIfNeeded(.fridge) }
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertEqual(ids(m).count, 36)
        await gate.open()
        await slow.value
        XCTAssertEqual(ids(m).count, 36, "A's late result must not overwrite B: \(ids(m).prefix(3))")
        XCTAssertFalse(ids(m).contains("item-chicken"))
        XCTAssertEqual(m.staggerRestarts, 1, "A's dropped result must not stagger")
    }

    func testSignOutDuringSlowLoadDiscardsOldResult() async {
        let (m, api, _, _) = make()
        let gate = SessionGate()
        await api.hold(list: gate)
        let slow = Task { await m.loadIfNeeded(.fridge) }
        await until { await gate.waiting }
        await m.sessionChanged(from: userA, to: nil)
        await gate.open()
        await slow.value
        XCTAssertTrue(isUnauthorized(m, .fridge), "A's late result must not resurrect rows after sign-out")
        XCTAssertEqual(m.staggerRestarts, 0)
    }

    func testRemoveInFlightThatSucceedsAfterSwitchLeaksNothingIntoB() async {
        let (m, api, _, b) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertNil(m.toast)
        await gate.open()
        await settle()
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner)
        XCTAssertEqual(ids(m).count, 36)
    }

    /// IOS-71 (fixed): a remove that fails after the user switched re-inserts A's row into B's list
    /// (`removeFailed` inserts into `sections[location.storage]` whenever the id isn't listed).
    func testRemoveInFlightThatFailsAfterSwitchDoesNotInsertARowIntoB() async {
        let (m, api, _, b) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate)
        await api.fail(remove: .network("offline"))
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await settle()
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner, "no banner about A's item in B's session")
        XCTAssertTrue(haptics.events.isEmpty, "no error haptic for A's item: \(haptics.events)")
        XCTAssertFalse(ids(m).contains("item-chicken"), "A's item leaked into B's list")
        XCTAssertEqual(ids(m).count, 36)
    }

    func testRemoveInFlightThatFailsAfterSignOutShowsNothing() async {
        let (m, api, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate)
        await api.fail(remove: .unauthorized)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gate.waiting }
        await m.sessionChanged(from: userA, to: nil)
        await gate.open()
        await settle()
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner)
        XCTAssertTrue(isUnauthorized(m, .fridge))
    }

    /// IOS-72 (fixed): an Undo whose restore fails after the user switched shows A's "Couldn't undo"
    /// banner (plus error haptic and a VoiceOver announcement) in B's session, and leaves A's id in
    /// `locallyRemoved`.
    func testRestoreInFlightThatFailsAfterSwitchShowsNoBannerInB() async {
        let (m, api, _, b) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await settle()                      // the remove reaches the server
        let gate = SessionGate()
        await api.hold(restore: gate)
        await api.fail(restore: .network("offline"))
        m.toast?.onUndo()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await settle()
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner, "A's undo failure must not surface in B")
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)")
    }

    func testRestoreInFlightThatSucceedsAfterSwitchLeaksNothingIntoB() async {
        let (m, api, _, b) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await settle()
        let gate = SessionGate()
        await api.hold(restore: gate)
        m.toast?.onUndo()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await settle()
        XCTAssertNil(m.banner)
        XCTAssertNil(m.toast)
        XCTAssertFalse(ids(m).contains("item-chicken"))
        XCTAssertEqual(ids(m).count, 36)
    }

    // MARK: Round 2: in-flight operations are not cancelled by a session change, and never leak

    /// Same item ids for both users, so anything that leaks from A's operations lands on a row B also has.
    private func makeSameIds(_ b: MockAPIClient.Behavior = .init(delay: .zero)) -> (FridgeModel, SwitchAPIClient, MockAPIClient, MockAPIClient) {
        let a = mock(.fridge, b), bb = mock(.fridge)
        let api = SwitchAPIClient(a)
        return (FridgeModel(api: api), api, a, bb)
    }

    /// The gate throws when the calling task is cancelled (like URLSession). If `sessionChanged` cancelled
    /// the tail, the remove would never reach the server and A's removal would be silently lost.
    func testRemoveInFlightIsNotCancelledBySwitchAndStillReachesTheServer() async {
        let (m, api, a, b) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate, cancellable: true)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await until { await api.removeCalls == ["item-chicken"] }
        let cancelled = await gate.sawCancellation
        XCTAssertFalse(cancelled, "a session change must not cancel in-flight operations")
        let removedOnA = await a.currentItems().first { $0.id == "item-chicken" }?.isRemoved
        XCTAssertEqual(removedOnA, true, "A's remove reached A's server")
        await settle()
        XCTAssertNil(m.toast); XCTAssertNil(m.banner)
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)")
        XCTAssertEqual(ids(m).count, 36, "nothing leaked into B")
    }

    func testUndoInFlightIsNotCancelledBySwitchAndStillReachesTheServer() async {
        let (m, api, a, b) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await api.removeCalls == ["item-chicken"] }
        let gate = SessionGate()
        await api.hold(restore: gate, cancellable: true)
        m.toast?.onUndo()
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await until { await api.restoreCalls == ["item-chicken"] }
        let cancelled = await gate.sawCancellation
        XCTAssertFalse(cancelled)
        let removedOnA = await a.currentItems().first { $0.id == "item-chicken" }?.isRemoved
        XCTAssertEqual(removedOnA, false, "A's Undo reached A's server")
        await settle()
        XCTAssertNil(m.toast); XCTAssertNil(m.banner)
        XCTAssertEqual(ids(m).count, 36)
    }

    /// `enqueue` guard: an Undo queued behind a held remove must not run once the session changed
    /// (it would otherwise call restore as the NEW user).
    func testUndoQueuedBehindHeldRemoveMakesNoRestoreCallAfterSwitch() async {
        let (m, api, a, b) = make()
        await m.loadIfNeeded(.fridge)
        let gate = SessionGate()
        await api.hold(remove: gate)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        m.toast?.onUndo()                       // queued behind the held remove
        await until { await gate.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        await gate.open()
        await until { await api.removeCalls == ["item-chicken"] }
        await settle()
        let restores = await api.restoreCalls, batch = await api.batchRestoreCalls
        XCTAssertEqual(restores, [], "the queued Undo belongs to the old session and must not run")
        XCTAssertEqual(batch, [])
        let removedOnA = await a.currentItems().first { $0.id == "item-chicken" }?.isRemoved
        XCTAssertEqual(removedOnA, true)
        XCTAssertNil(m.banner); XCTAssertNil(m.toast)
        XCTAssertEqual(ids(m).count, 36)
        XCTAssertTrue(haptics.events.isEmpty)
    }

    /// `perform` catch guard: A's remove fails after the switch while B has its OWN remove of the same id in
    /// flight. A's failure must not roll back B's row, show a banner or buzz.
    func testFailingRemoveAfterSwitchDoesNotTouchBsInFlightRemoveOfTheSameId() async {
        let (m, api, _, b) = makeSameIds()
        await m.loadIfNeeded(.fridge)
        let gateA = SessionGate()
        await api.hold(remove: gateA)
        await api.fail(remove: .network("offline"))
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await gateA.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertTrue(ids(m).contains("item-chicken"))
        let gateB = SessionGate()
        await api.hold(remove: gateB)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)   // B's own, held
        await until { await gateB.waiting }
        XCTAssertFalse(ids(m).contains("item-chicken"))
        await gateA.open()                      // A's remove now fails
        await settle()
        XCTAssertFalse(ids(m).contains("item-chicken"), "A's failure must not re-insert B's removed row")
        XCTAssertNil(m.banner, "no banner about A's item in B's session")
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)")
        await gateB.open()
        await until { await api.removeCalls == ["item-chicken"] }
        await settle()
        XCTAssertFalse(ids(m).contains("item-chicken"))
        XCTAssertNil(m.banner)
    }

    /// `undo` catch guard: A's restore fails after the switch while B has its own Undo of the same id in flight.
    func testFailingRestoreAfterSwitchDoesNotRemoveBsRestoredRow() async {
        let (m, api, _, b) = makeSameIds()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await api.removeCalls == ["item-chicken"] }
        let gateA = SessionGate()
        await api.hold(restore: gateA)
        await api.fail(restore: .network("offline"))
        m.toast?.onUndo()
        await until { await gateA.waiting }
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { await api.removeCalls == ["item-chicken", "item-chicken"] }
        let gateB = SessionGate()
        await api.hold(restore: gateB)
        m.toast?.onUndo()                       // B's Undo, held: B's reconcile entry for the id is alive
        await until { await gateB.waiting }
        XCTAssertTrue(ids(m).contains("item-chicken"))
        await gateA.open()                      // A's restore now fails
        await settle()
        XCTAssertTrue(ids(m).contains("item-chicken"), "A's failed Undo must not delete B's restored row")
        XCTAssertNil(m.banner)
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)")
        await gateB.open()
        await settle()
        XCTAssertTrue(ids(m).contains("item-chicken"))
    }

    /// `settleBatch` guard: the batch gets 409 already_removed, settleBatch asks for the listing, the user
    /// switches while that listing is held; the late answer must not roll back B's in-flight remove of the same id.
    func testBatchSettleAfterSwitchDoesNotTouchB() async {
        var beh = MockAPIClient.Behavior(delay: .zero)
        beh.failures["removeBatch"] = .server(status: 409, code: "already_removed", message: "x")
        let (m, api, _, b) = makeSameIds(beh)
        await m.loadIfNeeded(.fridge)
        let listGate = SessionGate()
        await api.hold(list: listGate)
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        await until { await listGate.waiting }  // settleBatch is asking for the listing
        await api.switchTo(b)
        await m.sessionChanged(from: userA, to: userB)
        let gateB = SessionGate()
        await api.hold(remove: gateB)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        await until { await gateB.waiting }
        XCTAssertFalse(ids(m).contains("item-chicken"))
        await listGate.open()
        await settle()
        XCTAssertFalse(ids(m).contains("item-chicken"), "A's late settle must not re-insert B's removed row")
        XCTAssertNil(m.banner)
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)")
        await gateB.open()
        await settle()
    }

    // MARK: Selection

    func testUserSwitchAndSignOutClearSelectModeAndSelection() async {
        let (m, _, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.enterSelection()
        m.toggleSelection("item-chicken")
        XCTAssertTrue(m.isSelecting); XCTAssertEqual(m.selection, ["item-chicken"])
        await m.sessionChanged(from: userA, to: userB)
        XCTAssertFalse(m.isSelecting)
        XCTAssertTrue(m.selection.isEmpty)
        m.enterSelection(); m.toggleSelection("item-long-1")
        await m.sessionChanged(from: userB, to: nil)
        XCTAssertFalse(m.isSelecting)
        XCTAssertTrue(m.selection.isEmpty)
    }

    func testTokenRefreshKeepsSelectMode() async {
        let (m, _, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.enterSelection()
        m.toggleSelection("item-chicken")
        await m.sessionChanged(from: userA, to: userA)
        XCTAssertTrue(m.isSelecting)
        XCTAssertEqual(m.selection, ["item-chicken"])
    }
}
