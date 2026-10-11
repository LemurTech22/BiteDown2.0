import XCTest
@testable import FoodWasteReducer

/// Records remove/restore calls and forwards everything to a `MockAPIClient`.
actor SpyAPIClient: APIClient {
    struct RemoveCall: Equatable { let id: String; let outcome: RemoveOutcome; let reason: WasteReason?; let recipient: String? }
    let inner: MockAPIClient
    private(set) var removes: [RemoveCall] = []
    private(set) var restores: [String] = []
    private(set) var lists = 0
    // Fridge-polish additions: the exact RecipientChoice, batch calls, and an ordered event log.
    struct BatchCall: Equatable { let ids: [String]; let outcome: RemoveOutcome; let recipient: RecipientChoice }
    private(set) var choices: [RecipientChoice] = []
    private(set) var batchRemoves: [BatchCall] = []
    private(set) var batchRestores: [[String]] = []
    private(set) var reachableCalls = 0
    /// "start:remove:id", "end:remove:id", "start:restore:id" ... for serialisation checks.
    private(set) var log: [String] = []
    init(_ inner: MockAPIClient) { self.inner = inner }

    func signup(email: String, password: String, displayName: String) async throws -> AuthSession { try await inner.signup(email: email, password: password, displayName: displayName) }
    func login(email: String, password: String) async throws -> AuthSession { try await inner.login(email: email, password: password) }
    func deleteAccount() async throws { try await inner.deleteAccount() }
    func listItems(storage: Storage?, groupBy: ItemGrouping?) async throws -> ItemListing { lists += 1; return try await inner.listItems(storage: storage, groupBy: groupBy) }
    func createItems(_ items: [NewItem]) async throws -> [Item] { try await inner.createItems(items) }
    func patchItem(id: String, _ patch: ItemPatch) async throws -> Item { try await inner.patchItem(id: id, patch) }
    func removeItem(id: String, outcome: RemoveOutcome, wasteReason: WasteReason?, recipient: RecipientChoice) async throws -> Item {
        removes.append(.init(id: id, outcome: outcome, reason: wasteReason, recipient: recipient.userId))
        choices.append(recipient)
        log.append("start:remove:\(id)")
        defer { log.append("end:remove:\(id)") }
        return try await inner.removeItem(id: id, outcome: outcome, wasteReason: wasteReason, recipient: recipient)
    }
    func health() async throws -> Bool { try await inner.health() }
    func me() async throws -> Me { try await inner.me() }
    func googleSignIn(idToken: String) async throws -> GoogleAuthResult { try await inner.googleSignIn(idToken: idToken) }
    func removeBatch(ids: [String], outcome: RemoveOutcome, recipient: RecipientChoice) async throws -> [Item] {
        batchRemoves.append(.init(ids: ids, outcome: outcome, recipient: recipient))
        log.append("start:removeBatch:\(ids.joined(separator: ","))")
        defer { log.append("end:removeBatch:\(ids.joined(separator: ","))") }
        return try await inner.removeBatch(ids: ids, outcome: outcome, recipient: recipient)
    }
    func restoreBatch(ids: [String]) async throws -> [Item] {
        batchRestores.append(ids)
        log.append("start:restoreBatch:\(ids.joined(separator: ","))")
        defer { log.append("end:restoreBatch:\(ids.joined(separator: ","))") }
        return try await inner.restoreBatch(ids: ids)
    }
    func fromReceipt(imageData: Data) async throws -> ReceiptResponse { try await inner.fromReceipt(imageData: imageData) }
    func barcode(_ code: String) async throws -> BarcodeResult { try await inner.barcode(code) }
    func listShares() async throws -> [PantryListing] { try await inner.listShares() }
    func createShare(itemId: String, groupId: String?) async throws -> Listing { try await inner.createShare(itemId: itemId, groupId: groupId) }
    func cancelShare(id: String) async throws -> Listing { try await inner.cancelShare(id: id) }
    func claimShare(id: String) async throws -> Listing { try await inner.claimShare(id: id) }
    func listRequests() async throws -> [HelpRequest] { try await inner.listRequests() }
    func listMyRequests() async throws -> [HelpRequest] { try await inner.listMyRequests() }
    func createRequest(text: String, friends: Bool, groupIds: [String]) async throws -> HelpRequest { try await inner.createRequest(text: text, friends: friends, groupIds: groupIds) }
    func fulfilRequest(id: String) async throws -> HelpRequest { try await inner.fulfilRequest(id: id) }
    func cancelRequest(id: String) async throws -> HelpRequest { try await inner.cancelRequest(id: id) }
    func listFriends() async throws -> FriendsResponse { try await inner.listFriends() }
    func requestFriend(email: String) async throws -> Friend { try await inner.requestFriend(email: email) }
    func acceptFriend(userId: String) async throws -> Friend { try await inner.acceptFriend(userId: userId) }
    func declineFriend(userId: String) async throws { try await inner.declineFriend(userId: userId) }
    func removeFriend(userId: String) async throws { try await inner.removeFriend(userId: userId) }
    func friendCode() async throws -> FriendCodeInfo { try await inner.friendCode() }
    func addFriend(code: String) async throws -> FriendAddResult { try await inner.addFriend(code: code) }
    func listGroups() async throws -> [SharingGroup] { try await inner.listGroups() }
    func createGroup(name: String) async throws -> SharingGroup { try await inner.createGroup(name: name) }
    func joinGroup(inviteCode: String) async throws -> SharingGroup { try await inner.joinGroup(inviteCode: inviteCode) }
    func leaveGroup(id: String) async throws { try await inner.leaveGroup(id: id) }
    func groupDetail(id: String) async throws -> GroupDetail { try await inner.groupDetail(id: id) }
    func groupPantry(id: String) async throws -> [PantryItem] { try await inner.groupPantry(id: id) }
    func share(itemId: String, audience: ShareAudience, pickup: Pickup?) async throws -> Listing { try await inner.share(itemId: itemId, audience: audience, pickup: pickup) }
    func updatePickup(listingId: String, pickup: Pickup?) async throws -> Listing { try await inner.updatePickup(listingId: listingId, pickup: pickup) }
    func reachablePeople(itemId: String?) async throws -> [Person] { reachableCalls += 1; return try await inner.reachablePeople(itemId: itemId) }
    func restoreItem(id: String) async throws -> Item {
        restores.append(id)
        log.append("start:restore:\(id)")
        defer { log.append("end:restore:\(id)") }
        return try await inner.restoreItem(id: id)
    }
    func fromPhoto(imageData: Data, mode: PhotoMode) async throws -> CandidatesResponse { try await inner.fromPhoto(imageData: imageData, mode: mode) }
    func parseText(_ text: String) async throws -> [Candidate] { try await inner.parseText(text) }
    func impact(range: ImpactRange) async throws -> Impact { try await inner.impact(range: range) }
    func tips() async throws -> [Tip] { try await inner.tips() }
    func recipesSuggest(maxResults: Int?, dietary: [String]?) async throws -> [Recipe] { try await inner.recipesSuggest(maxResults: maxResults, dietary: dietary) }
}

@MainActor
final class FridgeModelTests: XCTestCase {
    private var haptics: RecordingHaptics!
    private var savedProvider: HapticsProviding!

    override func setUp() async throws {
        savedProvider = Haptics.provider
        haptics = RecordingHaptics()
        Haptics.provider = haptics
    }
    override func tearDown() async throws { Haptics.provider = savedProvider }

    private func make(_ fixture: MockFixture = .fridge, _ behavior: MockAPIClient.Behavior = .init(delay: .zero))
        -> (FridgeModel, SpyAPIClient, MockAPIClient) {
        let mock = MockAPIClient(fixture: fixture, behavior: behavior)
        let spy = SpyAPIClient(mock)
        return (FridgeModel(api: spy), spy, mock)
    }

    private func until(_ timeout: TimeInterval = 3, _ cond: () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end { if await cond() { return }; try? await Task.sleep(for: .milliseconds(20)) }
        XCTFail("condition not met in \(timeout) s", file: file, line: line)
    }

    private func ids(_ m: FridgeModel, _ s: Storage = .fridge) -> [String] {
        guard case .content(let secs) = m.state(for: s) else { return [] }
        return secs.flatMap { $0.items.map(\.id) }
    }
    private func groups(_ m: FridgeModel) -> [FoodGroup] {
        guard case .content(let secs) = m.state(for: .fridge) else { return [] }
        return secs.map(\.foodGroup)
    }
    private func item(_ m: FridgeModel, _ id: String) -> Item {
        guard case .content(let secs) = m.state(for: .fridge) else { fatalError("no content") }
        return secs.flatMap(\.items).first { $0.id == id }!
    }
    private func serverItem(_ mock: MockAPIClient, _ id: String) async -> Item { await mock.currentItems().first { $0.id == id }! }

    // MARK: Loading and states

    func testStartsLoadingThenGroupsInDesignOrder() async {
        let (m, _, _) = make()
        guard case .loading = m.state(for: .fridge) else { return XCTFail("should start in .loading") }
        await m.loadIfNeeded(.fridge)
        XCTAssertEqual(groups(m), [.protein, .veggies, .fruit, .dairy])
        XCTAssertEqual(ids(m), ["item-chicken", "item-eggs", "item-spinach", "item-carrots", "item-strawberries",
                                "item-bananas", "item-yogurt", "item-oatmilk"])
    }

    func testEmptyAndErrorStatesAndRetry() async {
        let (e, _, _) = make(.empty)
        await e.loadIfNeeded(.fridge)
        guard case .empty = e.state(for: .fridge) else { return XCTFail("empty fixture → .empty") }

        var b = MockAPIClient.Behavior(delay: .zero); b.failFirst["listItems"] = 1
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        guard case .error = m.state(for: .fridge) else { return XCTFail("failure → .error") }
        await m.retry(.fridge)
        XCTAssertEqual(groups(m).count, 4, "retry loads content")
    }

    func testStorageFilterIsPerSegment() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.pantry)
        guard case .empty = m.state(for: .pantry) else { return XCTFail("fridge fixture has no pantry items") }
        guard case .loading = m.state(for: .fridge) else { return XCTFail("fridge not loaded yet") }
    }

    func testStaggerOnlyOnFirstLoadPerStorage() async {
        let (m, spy, _) = make()
        await m.loadIfNeeded(.fridge)
        XCTAssertEqual(m.staggerRestarts, 1)
        await m.loadIfNeeded(.fridge)          // no second fetch
        let lists = await spy.lists
        XCTAssertEqual(lists, 1)
        await m.refresh()
        await m.refresh()
        XCTAssertEqual(m.staggerRestarts, 1, "refresh must not restart the stagger")
        await m.loadIfNeeded(.pantry)          // empty: nothing to stagger
        XCTAssertEqual(m.staggerRestarts, 1)
    }

    func testRefreshFailureWithContentKeepsRowsAndShowsBanner() async {
        let (m, _, mock) = make()
        await m.loadIfNeeded(.fridge)
        await mock.setFailNetwork(true)
        await m.refresh()
        XCTAssertEqual(ids(m).count, 8, "rows stay on a failed refresh")
        XCTAssertNotNil(m.banner)
        XCTAssertNotNil(m.banner?.retry)
    }

    // MARK: Remove (optimistic)

    func testRemoveIsImmediateAndShowsToast() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        // Synchronous: the row is gone before any await.
        XCTAssertFalse(ids(m).contains("item-chicken"))
        // #64: the toast (and its countdown) waits for the sheet to dismiss.
        XCTAssertNil(m.toast, "the countdown must not start under the sheet")
        m.showPendingToast()   // the sheet's onDismiss
        XCTAssertEqual(m.toast?.message, "Chicken thighs removed")
        m.showPendingToast()
        XCTAssertEqual(m.toast?.message, "Chicken thighs removed", "showing twice is harmless")
        await until { await spy.removes.count == 1 }
        let call = await spy.removes.first
        XCTAssertEqual(call, .init(id: "item-chicken", outcome: .used, reason: nil, recipient: nil))
        let server = await serverItem(mock, "item-chicken")
        XCTAssertEqual(server.outcome, .used)
        XCTAssertTrue(haptics.events.isEmpty, "the model plays no haptic on success (the view does): \(haptics.events)")
    }

    func testThrownOutSendsReasonAndDonatedSendsRecipient() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-strawberries"), choice: .init(outcome: .thrownOut, wasteReason: .forgot), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .donated, recipient: .user("user-marcus")), reduceMotion: true)
        m.showPendingToast()   // the second sheet's onDismiss
        await until { await spy.removes.count == 2 }
        let calls = await spy.removes
        XCTAssertEqual(calls[0], .init(id: "item-strawberries", outcome: .thrownOut, reason: .forgot, recipient: nil))
        XCTAssertEqual(calls[1], .init(id: "item-spinach", outcome: .donated, reason: nil, recipient: "user-marcus"))
        await until { await self.serverItem(mock, "item-spinach").share?.status == .fulfilled }
        XCTAssertEqual(m.toast?.message, "Baby spinach removed", "a second removal replaces the toast")
    }

    func testRemovingLastItemOfAGroupDropsTheSection() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: false)
        XCTAssertEqual(groups(m), [.veggies, .fruit, .dairy])
    }

    func testFailedRemoveRollsBackWithBannerAndErrorHaptic() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["removeItem"] = .network("offline")
        let (m, _, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await until { self.ids(m) == before }
        XCTAssertEqual(ids(m), before, "row returns to its original position")
        XCTAssertNil(m.toast, "no Undo toast for a failed remove")
        XCTAssertEqual(m.banner?.message.contains("Baby spinach"), true, m.banner?.message ?? "nil")
        XCTAssertNotNil(m.banner?.retry)
        XCTAssertEqual(haptics.events, [.error])
        let server = await serverItem(mock, "item-spinach")
        XCTAssertFalse(server.isRemoved)
        // Retry from the banner once the server recovers.
        await mock.setFailure(nil, for: "removeItem")
        m.banner?.retry?()
        await until { await self.serverItem(mock, "item-spinach").isRemoved }
        XCTAssertFalse(ids(m).contains("item-spinach"))
    }

    func testRefreshRacingARemovalDoesNotResurrectTheRow() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["removeItem"] = .milliseconds(400)
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await m.refresh()   // server still has eggs active
        XCTAssertFalse(ids(m).contains("item-eggs"))
    }

    // MARK: Undo

    func testUndoRestoresAtSamePositionAndServer() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-carrots"), choice: .init(outcome: .donated), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await until { await self.serverItem(mock, "item-carrots").isRemoved }
        let hapticsBefore = haptics.events
        m.toast?.onUndo()
        XCTAssertEqual(ids(m), before, "Undo puts the row back immediately, in place")
        await until { await spy.restores == ["item-carrots"] }
        await until { await !self.serverItem(mock, "item-carrots").isRemoved }
        let server = await serverItem(mock, "item-carrots")
        XCTAssertEqual(server.share?.status, .open, "Undo reopens the listing the donation fulfilled")
        XCTAssertEqual(haptics.events, hapticsBefore, "Undo plays no haptic")
        XCTAssertNil(m.banner)
    }

    func testUndoBeforeRemoveSettlesStillRestores() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["removeItem"] = .milliseconds(300)
        let (m, spy, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        m.toast?.onUndo()
        XCTAssertTrue(ids(m).contains("item-eggs"))
        await until { await spy.restores.count == 1 }
        let server = await serverItem(mock, "item-eggs")
        XCTAssertFalse(server.isRemoved, "server ends active after remove-then-restore")
    }

    /// A removal that fails before the sheet dismisses shows only the banner, never a toast.
    func testRemoveFailingBeforeDismissShowsNoToast() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["removeItem"] = .network("offline")
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: false)
        await until { m.banner != nil }
        m.showPendingToast()   // sheet dismisses after the failure
        XCTAssertNil(m.toast)
        XCTAssertTrue(ids(m).contains("item-eggs"))
    }

    func testUndoAfterFailedRemoveDoesNotCallRestoreOrBanner() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.failures["removeItem"] = .network("offline"); b.delays["removeItem"] = .milliseconds(300)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        m.toast?.onUndo()
        try? await Task.sleep(for: .milliseconds(600))
        let restores = await spy.restores
        XCTAssertEqual(restores, [])
        XCTAssertNil(m.banner, "nothing to report: the person already undid it")
        XCTAssertEqual(ids(m).filter { $0 == "item-eggs" }.count, 1, "no duplicate row")
    }

    func testFailedRestoreRemovesAgainWithBanner() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["restoreItem"] = .network("offline")
        let (m, _, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-yogurt"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await until { await self.serverItem(mock, "item-yogurt").isRemoved }
        m.toast?.onUndo()
        await until { !self.ids(m).contains("item-yogurt") && m.banner != nil }
        XCTAssertNotNil(m.banner?.retry, "a network failure offers Try again")
        XCTAssertEqual(haptics.events, [.error])
    }

    func testRestoreWindowExpiredHasNoRetry() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["restoreItem"] = .restoreWindowExpired
        let (m, _, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-yogurt"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await until { await self.serverItem(mock, "item-yogurt").isRemoved }
        m.toast?.onUndo()
        await until { m.banner != nil }
        XCTAssertNil(m.banner?.retry)
        XCTAssertTrue(m.banner?.message.contains("too late") ?? false, m.banner?.message ?? "")
    }

    /// Orchestrator ruling (#64): a restore answered with 409 `not_removed` means the item is already
    /// active on the server, so Undo succeeded in effect: keep the row, no banner, no error haptic.
    func testRestoreNotRemovedKeepsRowWithoutBanner() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["restoreItem"] = .notRemoved
        let (m, spy, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-yogurt"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        await until { await self.serverItem(mock, "item-yogurt").isRemoved }
        m.toast?.onUndo()
        await until { await spy.restores.count == 1 }
        try? await Task.sleep(for: .milliseconds(200))   // let any rollback land
        XCTAssertEqual(ids(m), before, "row stays in place")
        XCTAssertNil(m.banner, "not_removed is not an error to the person")
        XCTAssertFalse(haptics.events.contains(.error), "\(haptics.events)")
    }

    func testToastTimeoutKeepsRemoval() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-oatmilk"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()   // the sheet's onDismiss
        m.toast?.onTimeout()
        m.toast = nil
        await m.refresh()
        XCTAssertFalse(ids(m).contains("item-oatmilk"))
        let restores = await spy.restores
        XCTAssertEqual(restores, [])
        let server = await serverItem(mock, "item-oatmilk")
        XCTAssertTrue(server.isRemoved)
    }

    // MARK: Text

    func testSheetAndRowText() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        XCTAssertEqual(ItemText.sheetMeta(item(m, "item-spinach")), "Veggies · 5 oz · expires tomorrow · on Share")
        XCTAssertEqual(ItemText.expiryPhrase(item(m, "item-spinach")), "expires tomorrow")
        // Fridge polish: meta is the quantity only; the badge is the row's one status.
        for id in ["item-strawberries", "item-bananas", "item-spinach", "item-chicken", "item-eggs"] {
            XCTAssertEqual(ItemText.meta(item(m, id)), ItemText.quantity(item(m, id)), id)
            XCTAssertFalse(ItemText.meta(item(m, id)).lowercased().contains("photo check"), id)
        }
        XCTAssertEqual(ItemText.quantity(item(m, "item-eggs")), "8")
        XCTAssertEqual(ItemText.quantity(item(m, "item-chicken")), "1.4 lb")
        XCTAssertTrue(ItemText.hasOpenListing(item(m, "item-carrots")))
        XCTAssertFalse(ItemText.hasOpenListing(item(m, "item-eggs")))
    }

    func testListingFixtureMatchesArtboard() {
        let items = MockData.items(for: .listing)
        let spinach = items.first { $0.id == "item-spinach" }!
        XCTAssertEqual(spinach.share?.status, .open)
        XCTAssertEqual(spinach.share?.claimedBy?.id, "user-marcus")
        XCTAssertEqual(spinach.share?.claimedBy?.name, "Marcus Ojeda")
        XCTAssertNil(items.first { $0.id == "item-carrots" }!.share?.claimedBy)
        XCTAssertEqual(MockFixture(name: "listing"), .listing)
    }

    func testMockRejectsRecipientOnNonDonated() async {
        let mock = MockAPIClient(fixture: .fridge, behavior: .init(delay: .zero))
        do { _ = try await mock.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil, recipientId: "user-marcus"); XCTFail() }
        catch let e as APIError { guard case .server(400, "validation_error", _) = e else { return XCTFail("\(e)") } }
        catch { XCTFail("\(error)") }
    }
}
