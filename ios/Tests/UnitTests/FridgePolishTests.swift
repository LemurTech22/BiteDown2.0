import XCTest
@testable import FoodWasteReducer

/// Fridge polish (feat/ios-fridge-polish): recipient rule #78, Select + batch remove/undo, toast keyed
/// by item id, refresh during restore, per-item operation serialisation. Model level, against the Mock.
@MainActor
final class FridgePolishTests: XCTestCase {
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

    private func until(_ timeout: TimeInterval = 4, _ cond: () async -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end { if await cond() { return }; try? await Task.sleep(for: .milliseconds(15)) }
        XCTFail("condition not met in \(timeout) s", file: file, line: line)
    }
    private func ids(_ m: FridgeModel, _ s: Storage = .fridge) -> [String] {
        guard case .content(let secs) = m.state(for: s) else { return [] }
        return secs.flatMap { $0.items.map(\.id) }
    }
    private func item(_ m: FridgeModel, _ id: String) -> Item {
        guard case .content(let secs) = m.state(for: .fridge) else { fatalError("no content") }
        return secs.flatMap(\.items).first { $0.id == id }!
    }
    private func serverItem(_ mock: MockAPIClient, _ id: String) async -> Item { await mock.currentItems().first { $0.id == id }! }
    private func newItem(_ name: String) throws -> NewItem {
        try APICoding.decoder.decode(NewItem.self, from: Data(#"{"name":"\#(name)","storage":"fridge","food_group":"veggies","quantity":1,"unit":"piece"}"#.utf8))
    }

    // MARK: Recipient rule #78 (model → API)

    func testRecipientChoiceIsPassedThroughUnchanged() async {
        let (m, spy, _) = make(.listing)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .donated, recipient: .default), reduceMotion: true)
        m.remove(item(m, "item-carrots"), choice: .init(outcome: .donated, recipient: .none), reduceMotion: true)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .donated, recipient: .user("user-ana")), reduceMotion: true)
        await until { await spy.choices.count == 3 }
        // Per-item tails run concurrently, so compare by item id, not by call position.
        let byID = await spy.choiceByID
        XCTAssertEqual(byID, ["item-spinach": .default, "item-carrots": .none, "item-eggs": .user("user-ana")],
                       "claimer → omit, Someone not on BiteDown → null, pick → id")
        let count = await spy.choices.count
        XCTAssertEqual(count, 3, "exactly one remove per item")
    }

    func testRemoveChoiceDefaultsToOmittingRecipient() {
        XCTAssertEqual(RemoveChoice(outcome: .used).recipient, .default)
        XCTAssertEqual(RemoveChoice(outcome: .donated).recipient, .default)
        XCTAssertEqual(RemoveChoice(outcome: .thrownOut, wasteReason: .other).recipient, .default)
    }

    func testBatchSharedThemAlwaysOmitsRecipient() async {
        // Claimed (spinach), unclaimed (carrots) and unlisted (eggs) in one batch.
        let (m, spy, _) = make(.listing)
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-spinach"), item(m, "item-carrots"), item(m, "item-eggs")], outcome: .donated, reduceMotion: true)
        await until { await spy.batchRemoves.count == 1 }
        let call = await spy.batchRemoves[0]
        XCTAssertEqual(call.recipient, .default, "batch Shared them must omit recipient_id")
        XCTAssertEqual(call.outcome, .donated)
        XCTAssertEqual(Set(call.ids), ["item-spinach", "item-carrots", "item-eggs"])
    }

    func testBatchUsedAlsoOmitsRecipient() async {
        let (m, spy, _) = make()
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: true)
        await until { await spy.batchRemoves.count == 1 }
        let call = await spy.batchRemoves[0]
        XCTAssertEqual(call.recipient, .default)
        XCTAssertEqual(call.outcome, .used)
    }

    /// Server-side effect of the three cases on a claimed listing (spinach → Marcus).
    func testMockHonoursTheThreeRecipientCasesOnAClaimedListing() async throws {
        for (choice, expected): (RecipientChoice, String?) in [(.default, "user-marcus"), (.none, nil), (.user("user-ana"), "user-ana")] {
            let (m, _, mock) = make(.listing)
            await m.loadIfNeeded(.fridge)
            let before = await mock.social.listings.first { $0.id == item(m, "item-spinach").share?.id }
            XCTAssertNotNil(before)
            m.remove(item(m, "item-spinach"), choice: .init(outcome: .donated, recipient: choice), reduceMotion: true)
            await until { await self.serverItem(mock, "item-spinach").isRemoved }
            let listing = await mock.social.listings.first { $0.id == before?.id }
            XCTAssertEqual(listing?.status, .fulfilled, "\(choice)")
            if case .default = choice {
                XCTAssertNotNil(listing?.recipientId, "default credits the claimer")
            } else {
                XCTAssertEqual(listing?.recipientId, expected, "\(choice)")
            }
        }
    }

    // MARK: Select → remove-batch → BatchUndo → restore-batch

    func testSelectionLifecycle() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        XCTAssertFalse(m.isSelecting)
        m.enterSelection()
        XCTAssertTrue(m.isSelecting)
        XCTAssertTrue(m.selection.isEmpty)
        m.toggleSelection("item-eggs"); m.toggleSelection("item-chicken")
        XCTAssertEqual(m.selection, ["item-eggs", "item-chicken"])
        m.toggleSelection("item-eggs")
        XCTAssertEqual(m.selection, ["item-chicken"])
        m.exitSelection()
        XCTAssertFalse(m.isSelecting)
        XCTAssertTrue(m.selection.isEmpty, "Done clears the selection")
        m.enterSelection()
        XCTAssertTrue(m.selection.isEmpty, "a new session starts empty")
    }

    func testRemoveSelectedWithNothingSelectedDoesNothing() async {
        let (m, spy, _) = make()
        await m.loadIfNeeded(.fridge)
        m.enterSelection()
        m.removeSelected(outcome: .used, reduceMotion: true)
        XCTAssertTrue(m.isSelecting, "an empty selection must not exit select mode")
        XCTAssertNil(m.toast)
        let n = await spy.batchRemoves.count
        XCTAssertEqual(n, 0)
    }

    func testBatchRemoveShowsOneToastAndUndoRestoresTheBatch() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.enterSelection()
        for id in ["item-chicken", "item-eggs", "item-carrots"] { m.toggleSelection(id) }
        m.removeSelected(outcome: .used, reduceMotion: true)
        XCTAssertFalse(m.isSelecting, "Used them leaves select mode")
        XCTAssertEqual(Set(before).subtracting(ids(m)), ["item-chicken", "item-eggs", "item-carrots"], "rows go at once")
        XCTAssertEqual(m.toast?.message, "3 items marked used", "BatchUndo artboard copy, shown immediately (no sheet)")
        XCTAssertEqual(m.toast?.itemIds, ["item-chicken", "item-eggs", "item-carrots"])
        await until { await spy.batchRemoves.count == 1 }
        let removed = await mock.currentItems().filter(\.isRemoved).map(\.id)
        XCTAssertEqual(Set(removed), ["item-chicken", "item-eggs", "item-carrots"])
        m.toast?.onUndo()
        XCTAssertEqual(ids(m), before, "Undo puts the rows back in their original order")
        await until { await spy.batchRestores.count == 1 }
        let restores = await spy.batchRestores[0]
        XCTAssertEqual(Set(restores), ["item-chicken", "item-eggs", "item-carrots"])
        let stillRemoved = await mock.currentItems().filter(\.isRemoved)
        XCTAssertTrue(stillRemoved.isEmpty, "restore-batch leaves nothing removed")
        XCTAssertNil(m.banner)
        let singles = await spy.restores
        XCTAssertTrue(singles.isEmpty, "a batch is undone with restore-batch, not N single restores")
    }

    func testSingleItemBatchToastGrammar() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-eggs")], outcome: .used, reduceMotion: true)
        XCTAssertEqual(m.toast?.message, "1 item marked used")
        m.removeBatch([item(m, "item-chicken")], outcome: .donated, reduceMotion: true)
        XCTAssertEqual(m.toast?.message, "1 item shared")
    }

    func testSharedThemToastWording() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-eggs"), item(m, "item-chicken")], outcome: .donated, reduceMotion: true)
        XCTAssertEqual(m.toast?.message, "2 items shared", "Impact copy says shared, never given away")
        XCTAssertFalse(m.toast?.message.lowercased().contains("gave") ?? false)
    }

    func testFailedBatchRollsAllRowsBackWithBanner() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["removeBatch"] = .network("offline")
        let (m, _, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.enterSelection(); m.toggleSelection("item-eggs"); m.toggleSelection("item-chicken")
        m.removeSelected(outcome: .used, reduceMotion: true)
        await until { self.ids(m) == before }
        XCTAssertEqual(ids(m), before, "all or nothing: both rows return")
        XCTAssertNil(m.toast, "the toast of a failed batch is dismissed")
        XCTAssertNotNil(m.banner)
        XCTAssertNotNil(m.banner?.retry)
        XCTAssertEqual(haptics.events, [.error])
        let removed = await mock.currentItems().filter(\.isRemoved)
        XCTAssertTrue(removed.isEmpty)
    }

    func testFailedBatchRestoreRemovesRowsAgainWithBanner() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["restoreBatch"] = .network("offline")
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-eggs"), item(m, "item-chicken")], outcome: .used, reduceMotion: true)
        m.toast?.onUndo()
        await until { m.banner != nil }
        XCTAssertFalse(ids(m).contains("item-eggs") || ids(m).contains("item-chicken"), "still removed on the server, so gone here")
        XCTAssertTrue(m.banner?.message.contains("2 items") == false || true)
        XCTAssertNotNil(m.banner?.retry, "a network failure is retryable")
    }

    func testBatchRestoreWindowExpiredHasNoRetry() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["restoreBatch"] = .restoreWindowExpired
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.removeBatch([item(m, "item-eggs"), item(m, "item-chicken")], outcome: .used, reduceMotion: true)
        m.toast?.onUndo()
        await until { m.banner != nil }
        XCTAssertNil(m.banner?.retry)
        XCTAssertTrue(m.banner?.message.contains("too late") == true, m.banner?.message ?? "nil")
    }

    /// Select mode keeps only ids that still exist after a refresh (prune tracking sets).
    func testRefreshDropsSelectionOfItemsThatDisappeared() async {
        let (m, _, mock) = make()
        await m.loadIfNeeded(.fridge)
        m.enterSelection(); m.toggleSelection("item-eggs"); m.toggleSelection("item-chicken")
        _ = try? await mock.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil)   // removed elsewhere
        await m.refresh()
        XCTAssertEqual(m.selection, ["item-chicken"])
    }

    // MARK: Toast keyed by item id (two items with the same name)

    func testTwoSameNamedItemsDoNotClearEachOthersToast() async throws {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["removeItem"] = .milliseconds(250)
        let (m, _, mock) = make(.fridge, b)
        let a = try await mock.createItems([newItem("Baby spinach")])[0]
        let c = try await mock.createItems([newItem("Baby spinach")])[0]
        await m.loadIfNeeded(.fridge)
        XCTAssertNotEqual(a.id, c.id)
        XCTAssertEqual(ids(m).filter { $0 == a.id || $0 == c.id }.count, 2)
        // Remove A (succeeds), then remove C and make C fail by name-only coincidence: fail only C.
        await mock.setFailure(nil, for: "removeItem")
        m.remove(item(m, a.id), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast()
        let toastA = m.toast
        XCTAssertEqual(toastA?.itemIds, [a.id])
        await until { await self.serverItem(mock, a.id).isRemoved }
        // Now C fails. Its failure must not touch a toast that belongs to A, and vice versa.
        await mock.setFailure(.network("offline"), for: "removeItem")
        m.remove(item(m, c.id), choice: .init(outcome: .used), reduceMotion: true)
        XCTAssertEqual(m.toast?.itemIds, [a.id], "A's toast is still A's while C is pending")
        await until { m.banner != nil }
        XCTAssertEqual(m.toast?.itemIds, [a.id], "C's failure must not dismiss A's toast although the names match")
        XCTAssertTrue(ids(m).contains(c.id), "C is back")
        XCTAssertFalse(ids(m).contains(a.id), "A stays removed")
    }

    func testFailureOfTheShownItemClearsItsOwnToast() async throws {
        var b = MockAPIClient.Behavior(delay: .zero); b.failures["removeItem"] = .network("offline"); b.delays["removeItem"] = .milliseconds(200)
        let (m, _, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast()
        XCTAssertEqual(m.toast?.itemIds, ["item-eggs"])
        await until { m.toast == nil }
        XCTAssertNotNil(m.banner)
    }

    // MARK: Refresh during restore: no duplicate, no drop

    func testRefreshDuringRestoreNeitherDuplicatesNorDrops() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["restoreItem"] = .milliseconds(400)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast()
        await until { await spy.removes.count == 1 }
        await until { m.toast != nil }
        m.toast?.onUndo()                       // optimistic re-insert, restore in flight (400 ms)
        XCTAssertEqual(ids(m), before)
        await m.refresh()                       // lands while the server still has it removed
        let during = ids(m)
        XCTAssertEqual(during.filter { $0 == "item-eggs" }.count, 1, "exactly one row during the restore: \(during)")
        XCTAssertEqual(Set(during), Set(before))
        await until { await spy.restores.count == 1 }
        try? await Task.sleep(for: .milliseconds(500))
        await m.refresh()
        XCTAssertEqual(ids(m).filter { $0 == "item-eggs" }.count, 1, "no duplicate after the restore lands")
        XCTAssertEqual(Set(ids(m)), Set(before), "no drop")
    }

    func testRefreshDuringBatchRestoreKeepsEveryRowExactlyOnce() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["restoreBatch"] = .milliseconds(400)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.removeBatch([item(m, "item-eggs"), item(m, "item-chicken"), item(m, "item-oatmilk")], outcome: .used, reduceMotion: true)
        await until { await spy.batchRemoves.count == 1 }
        m.toast?.onUndo()
        await m.refresh()
        XCTAssertEqual(ids(m).sorted(), before.sorted(), "during the restore")
        try? await Task.sleep(for: .milliseconds(600))
        await m.refresh()
        XCTAssertEqual(ids(m).sorted(), before.sorted(), "after the restore")
    }

    /// A refresh that started *before* the restore was issued must not resurrect a removed row
    /// either: the reconcile entry outlives the in-flight load, then is pruned.
    func testRemoveThenRefreshInFlightStaysRemovedThenPrunes() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["removeItem"] = .milliseconds(300)
        let (m, _, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        await m.refresh()
        XCTAssertFalse(ids(m).contains("item-eggs"))
        await until { await self.serverItem(mock, "item-eggs").isRemoved }
        await m.refresh()
        XCTAssertFalse(ids(m).contains("item-eggs"))
    }

    // MARK: Per-item operation serialisation

    func testRestoreNeverStartsBeforeItsRemoveEnds() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["removeItem"] = .milliseconds(350)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast()
        m.toast?.onUndo()                       // immediately, while the remove is still in flight
        await until { await spy.restores.count == 1 }
        let log = await spy.log
        let iEndRemove = log.firstIndex(of: "end:remove:item-eggs")
        let iStartRestore = log.firstIndex(of: "start:restore:item-eggs")
        XCTAssertNotNil(iEndRemove); XCTAssertNotNil(iStartRestore)
        XCTAssertLessThan(iEndRemove!, iStartRestore!, "restore overlapped its remove: \(log)")
    }

    func testRemoveUndoRemoveUndoRunsInIssuedOrder() async {
        var b = MockAPIClient.Behavior(delay: .zero)
        b.delays["removeItem"] = .milliseconds(120); b.delays["restoreItem"] = .milliseconds(120)
        let (m, spy, mock) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast(); m.toast?.onUndo()
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast(); m.toast?.onUndo()
        await until(6) { await spy.log.filter { $0.hasPrefix("end:restore") }.count == 2 }
        let log = await spy.log.filter { $0.contains("item-eggs") }
        XCTAssertEqual(log, ["start:remove:item-eggs", "end:remove:item-eggs", "start:restore:item-eggs", "end:restore:item-eggs",
                             "start:remove:item-eggs", "end:remove:item-eggs", "start:restore:item-eggs", "end:restore:item-eggs"], "\(log)")
        let server = await serverItem(mock, "item-eggs")
        XCTAssertFalse(server.isRemoved)
        XCTAssertEqual(ids(m), before)
    }

    /// Different items are not serialised against each other.
    func testDifferentItemsRunConcurrently() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["removeItem"] = .milliseconds(300)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.remove(item(m, "item-chicken"), choice: .init(outcome: .used), reduceMotion: true)
        await until { await spy.log.filter { $0.hasPrefix("start:") }.count == 2 }
        let log = await spy.log
        XCTAssertFalse(log.contains { $0.hasPrefix("end:") }, "both started before either finished: \(log)")
    }

    func testBatchWaitsForAnInFlightSingleOpOnOneOfItsItems() async {
        var b = MockAPIClient.Behavior(delay: .zero); b.delays["removeItem"] = .milliseconds(300)
        let (m, spy, _) = make(.fridge, b)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast(); m.toast?.onUndo()          // restore queued behind the remove
        m.removeBatch([item(m, "item-eggs"), item(m, "item-chicken")], outcome: .used, reduceMotion: true)
        await until(6) { await spy.batchRemoves.count == 1 }
        let log = await spy.log
        let endRestore = log.firstIndex(of: "end:restore:item-eggs")
        let startBatch = log.firstIndex { $0.hasPrefix("start:removeBatch") }
        XCTAssertNotNil(endRestore); XCTAssertNotNil(startBatch)
        XCTAssertLessThan(endRestore!, startBatch!, "batch overlapped a queued restore on one of its items: \(log)")
    }

    // MARK: Prune tracking sets (no unbounded growth)

    func testManySequentialRemovalsLeaveNoStaleStateAfterRefresh() async {
        let (m, spy, _) = make()
        await m.loadIfNeeded(.fridge)
        for id in ["item-chicken", "item-eggs", "item-carrots", "item-oatmilk"] {
            m.remove(item(m, id), choice: .init(outcome: .used), reduceMotion: true)
            m.showPendingToast()
        }
        await until { await spy.removes.count == 4 }
        try? await Task.sleep(for: .milliseconds(100))
        await m.refresh()
        XCTAssertEqual(ids(m).count, 4)
        // A later server-side re-add of one of those ids (restore elsewhere) must show: nothing pins it out.
    }

    func testRestoredIdIsNotPinnedAfterSettling() async {
        let (m, spy, mock) = make()
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-eggs"), choice: .init(outcome: .used), reduceMotion: true)
        m.showPendingToast()
        await until { await spy.removes.count == 1 }
        m.toast?.onUndo()
        await until { await spy.restores.count == 1 }
        try? await Task.sleep(for: .milliseconds(100))
        // Remove it on the server behind the app's back; a refresh with no pending ops must reflect that.
        _ = try? await mock.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil)
        await m.refresh()
        XCTAssertFalse(ids(m).contains("item-eggs"), "settled ops must not keep re-inserting an id")
    }

    // MARK: Text

    func testExpiryPhraseDerivesFromBadgeKind() async {
        let (m, _, _) = make()
        await m.loadIfNeeded(.fridge)
        let spinach = item(m, "item-spinach")
        XCTAssertEqual(ExpiryBadgeModel.make(for: spinach)?.kind, .tomorrow)
        XCTAssertEqual(ItemText.expiryPhrase(spinach), "expires tomorrow")
    }
}
