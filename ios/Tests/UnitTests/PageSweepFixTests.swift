import XCTest
@testable import FoodWasteReducer

/// Regression tests for the 2026-10-11 page-sweep fixes: A2 `RequestSourceInfo`, A3 `?item_id=`,
/// A4 stale-token 401, F1 retry toast, F2 remove-outcome classification.
/// F3 (RemoveSheet `submitted`, hidden back button) and A1 (button tint) are view-only: manual checks.
final class RequestSourceDecodingTests: XCTestCase {
    private func request(source: String?) -> String {
        let src = source.map { ",\"source\":\($0)" } ?? ""
        return """
        {"id":"r-1","author_id":"u","author_name":"A","text":"t","status":"open","fulfilled_by":null,"fulfilled_by_name":null,
         "created_at":"2026-10-10T12:00:00Z","audiences":{"friends":true,"groups":[],"hidden_count":0}\(src)}
        """
    }
    private func decode(_ source: String?) throws -> HelpRequest {
        try APICoding.decoder.decode(HelpRequest.self, from: Data(request(source: source).utf8))
    }

    func testObjectSourceDecodesTypeAndName() throws {
        let r = try decode(#"{"type":"group","name":"Moody Hall 4F"}"#)
        XCTAssertEqual(r.source, RequestSourceInfo(type: .group, name: "Moody Hall 4F"))
        let f = try decode(#"{"type":"friend","name":"Marcus"}"#)
        XCTAssertEqual(f.source.type, .friend)
        XCTAssertEqual(f.source.name, "Marcus")
    }

    func testObjectSourceWithoutNameOrNullName() throws {
        XCTAssertNil(try decode(#"{"type":"me"}"#).source.name)
        let r = try decode(#"{"type":"me","name":null}"#)
        XCTAssertEqual(r.source.type, .me)
        XCTAssertNil(r.source.name)
    }

    func testLegacyBareStringStillDecodes() throws {
        for (raw, expected) in [("me", RequestSource.me), ("friend", .friend), ("group", .group)] {
            let r = try decode("\"\(raw)\"")
            XCTAssertEqual(r.source.type, expected)
            XCTAssertNil(r.source.name)
        }
    }

    func testUnknownValuesFallBackToFriend() throws {
        XCTAssertEqual(try decode("\"martian\"").source.type, .friend)
        XCTAssertEqual(try decode(#"{"type":"martian","name":"x"}"#).source.type, .friend)
        XCTAssertEqual(try decode("{}").source.type, .friend)
    }

    func testRoundTripKeepsObjectShape() throws {
        let r = try decode(#"{"type":"group","name":"G"}"#)
        let back = try APICoding.decoder.decode(HelpRequest.self, from: try APICoding.encoder.encode(r))
        XCTAssertEqual(back.source, r.source)
    }

    func testPostRequestsResponseWithObjectSource() async throws {
        StubURLProtocol.reset(); defer { StubURLProtocol.reset() }
        let suite = "PageSweep-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        let c = await MainActor.run {
            LiveAPIClient(baseURL: BaseURLProvider(defaults: defaults, infoValue: nil),
                          auth: AuthStore(storage: InMemorySessionStorage(AuthSession(token: "tok-1", user: MockData.priya))),
                          session: URLSession(configuration: cfg))
        }
        let json = #"{"request":"# + request(source: #"{"type":"me","name":"Priya"}"#) + "}"
        StubURLProtocol.handler = { _ in .init(status: 201, body: Data(json.utf8)) }
        let r = try await c.createRequest(text: "t", friends: true, groupIds: [])
        XCTAssertEqual(r.source, RequestSourceInfo(type: .me, name: "Priya"))
        XCTAssertEqual(StubURLProtocol.requests.last?.httpMethod, "POST")
    }

    func testMockRequestsCarryAuthorOrGroupName() async throws {
        let c = MockAPIClient(fixture: .fridge, behavior: .init(delay: .zero), signedIn: true)
        let board = try await c.listRequests()
        for r in board {
            switch r.source.type {
            case .group: XCTAssertEqual(r.source.name, r.groupName, r.id)
            case .friend, .me: XCTAssertEqual(r.source.name, r.authorName, r.id)
            }
        }
        let created = try await c.createRequest(text: "Need salt", friends: true, groupIds: [])
        XCTAssertEqual(created.source.type, .me)
        XCTAssertEqual(created.authorName, MockData.priya.displayName)
        XCTAssertEqual(created.source.name, MockData.priya.displayName, "a request I created carries my name as its source")
    }
}

final class ReachablePeopleItemIdTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suite = ""
    override func setUp() {
        StubURLProtocol.reset()
        suite = "PageSweepPeople-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }
    override func tearDown() { defaults.removePersistentDomain(forName: suite); StubURLProtocol.reset() }

    @MainActor private func client() -> LiveAPIClient {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        return LiveAPIClient(baseURL: BaseURLProvider(defaults: defaults, infoValue: nil),
                             auth: AuthStore(storage: InMemorySessionStorage(AuthSession(token: "tok-1", user: MockData.priya))),
                             session: URLSession(configuration: cfg))
    }
    private let reply = #"{"people":[{"id":"u","display_name":"A","kind":"friend","is_claimer":true}]}"#

    func testItemIdSentAsQuery() async throws {
        let c = await client()
        StubURLProtocol.handler = { _ in .init(status: 200, body: Data(self.reply.utf8)) }
        _ = try await c.reachablePeople(itemId: "item-1")
        let r = try XCTUnwrap(StubURLProtocol.requests.last)
        XCTAssertEqual(r.httpMethod, "GET")
        XCTAssertEqual(r.url?.path, "/people/reachable")
        XCTAssertEqual(r.url?.query, "item_id=item-1")
    }

    func testNilItemIdSendsNoQuery() async throws {
        let c = await client()
        StubURLProtocol.handler = { _ in .init(status: 200, body: Data(self.reply.utf8)) }
        _ = try await c.reachablePeople(itemId: nil)
        XCTAssertNil(StubURLProtocol.requests.last?.url?.query)
        _ = try await c.reachablePeople()   // the protocol-extension convenience
        XCTAssertNil(StubURLProtocol.requests.last?.url?.query)
    }

    func testItemIdIsPercentEncodedAsQueryValue() async throws {
        let c = await client()
        StubURLProtocol.handler = { _ in .init(status: 200, body: Data(self.reply.utf8)) }
        _ = try await c.reachablePeople(itemId: "a&b=c d")
        let q = try XCTUnwrap(StubURLProtocol.requests.last?.url?.query)
        XCTAssertFalse(q.contains("&b"), "an ampersand in the id must not start a new parameter: \(q)")
        let items = URLComponents(string: "x://h/?" + q)?.queryItems
        XCTAssertEqual(items?.count, 1)
        XCTAssertEqual(items?.first?.value, "a&b=c d")
    }

    func testMockPutsClaimerFirstAndFlagsOnlyThem() async throws {
        let c = MockAPIClient(fixture: .fridge, behavior: .init(delay: .zero), signedIn: true)
        let plain = try await c.reachablePeople(itemId: nil)
        let forSpinach = try await c.reachablePeople(itemId: "item-spinach")
        XCTAssertEqual(Set(forSpinach.map(\.id)), Set(plain.map(\.id)), "same people, only reordered")
        XCTAssertEqual(forSpinach.first?.id, MockData.marcusFull.id)
        XCTAssertEqual(forSpinach.filter { $0.isClaimer == true }.map(\.id), [MockData.marcusFull.id])
        // The rest keep their relative order.
        XCTAssertEqual(forSpinach.dropFirst().map(\.id), plain.map(\.id).filter { $0 != MockData.marcusFull.id })
    }

    func testMockUnclaimedOrUnknownItemFlagsNobody() async throws {
        let c = MockAPIClient(fixture: .fridge, behavior: .init(delay: .zero), signedIn: true)
        let carrots = try await c.reachablePeople(itemId: "item-carrots")   // listed, not claimed
        XCTAssertTrue(carrots.allSatisfy { $0.isClaimer != true })
        let unknown = try await c.reachablePeople(itemId: "nope")
        // IOS-70: an unknown item falls back to the unflagged-by-itemId baseline, which still pre-flags Marcus;
        // the real backend would 404. Pinned as-is until the Mock decides.
        let plain = try await c.reachablePeople(itemId: nil)
        XCTAssertEqual(unknown.map(\.id), plain.map(\.id))
    }
}

final class StaleTokenSignOutTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suite = ""
    override func setUp() {
        StubURLProtocol.reset()
        suite = "PageSweep401-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }
    override func tearDown() { defaults.removePersistentDomain(forName: suite); StubURLProtocol.reset() }

    @MainActor private func make() -> (LiveAPIClient, AuthStore) {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        let store = AuthStore(storage: InMemorySessionStorage(AuthSession(token: "old-tok", user: MockData.priya)))
        return (LiveAPIClient(baseURL: BaseURLProvider(defaults: defaults, infoValue: nil), auth: store,
                              session: URLSession(configuration: cfg)), store)
    }
    private let body = Data(#"{"error":{"code":"unauthorized","message":"Token expired"}}"#.utf8)

    func testStaleTokenUnauthorizedKeepsNewerSession() async throws {
        let (c, store) = await make()
        let body = self.body
        // While the request is in flight, the user signs in again (new token).
        StubURLProtocol.handler = { _ in
            DispatchQueue.main.sync {
                MainActor.assumeIsolated { store.signIn(AuthSession(token: "new-tok", user: MockData.priya)) }
            }
            return .init(status: 401, body: body)
        }
        do { _ = try await c.listItems(storage: nil, groupBy: nil); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized, "the call itself still fails") }
        let (signedIn, token) = await MainActor.run { (store.isSignedIn, store.token) }
        XCTAssertTrue(signedIn, "a 401 for the old token must not sign out the new session")
        XCTAssertEqual(token, "new-tok")
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer old-tok")
    }

    // Friend-code add (`POST /friends`) has its own request path: same stale-token rule, and it expires the session.

    func testFriendCodeUnauthorizedWithCurrentTokenExpiresTheSession() async throws {
        let (c, store) = await make()
        let body = self.body
        StubURLProtocol.handler = { _ in .init(status: 401, body: body) }
        do { _ = try await c.addFriend(code: "ABCD1234"); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        let (signedIn, expired) = await MainActor.run { (store.isSignedIn, store.sessionExpired) }
        XCTAssertFalse(signedIn)
        XCTAssertTrue(expired, "SessionExpired is shown, not a silent sign-out")
    }

    func testFriendCodeStaleTokenUnauthorizedKeepsNewerSession() async throws {
        let (c, store) = await make()
        let body = self.body
        StubURLProtocol.handler = { _ in
            DispatchQueue.main.sync {
                MainActor.assumeIsolated { store.signIn(AuthSession(token: "new-tok", user: MockData.priya)) }
            }
            return .init(status: 401, body: body)
        }
        do { _ = try await c.addFriend(code: "ABCD1234"); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        let (signedIn, token, expired) = await MainActor.run { (store.isSignedIn, store.token, store.sessionExpired) }
        XCTAssertTrue(signedIn)
        XCTAssertEqual(token, "new-tok")
        XCTAssertFalse(expired)
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer old-tok")
    }

    func testCurrentTokenUnauthorizedSignsOut() async throws {
        let (c, store) = await make()
        let body = self.body
        StubURLProtocol.handler = { _ in .init(status: 401, body: body) }
        do { _ = try await c.listItems(storage: nil, groupBy: nil); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        let signedIn = await store.isSignedIn
        XCTAssertFalse(signedIn)
    }

    func testUnauthorizedAfterSignOutAndSignInStillSignsOutOnlyMatchingSession() async throws {
        // Signed out while in flight, nobody signed in: nil != "old-tok", so nothing to sign out and no crash.
        let (c, store) = await make()
        let body = self.body
        StubURLProtocol.handler = { _ in
            DispatchQueue.main.sync { MainActor.assumeIsolated { store.signOut() } }
            return .init(status: 401, body: body)
        }
        do { _ = try await c.listItems(storage: nil, groupBy: nil); XCTFail("expected throw") }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        let signedIn = await store.isSignedIn
        XCTAssertFalse(signedIn)
    }
}

@MainActor
final class FridgeRemoveOutcomeTests: XCTestCase {
    private var haptics: RecordingHaptics!
    private var savedProvider: HapticsProviding!
    override func setUp() async throws {
        savedProvider = Haptics.provider
        haptics = RecordingHaptics()
        Haptics.provider = haptics
    }
    override func tearDown() async throws { Haptics.provider = savedProvider }

    /// The spy in front of the mock of the last `make`: what actually reached the (mock) server.
    private var spy: SpyAPIClient!
    private func make(failing error: APIError?) -> (FridgeModel, MockAPIClient) {
        var b = MockAPIClient.Behavior(delay: .zero)
        if let error { b.failures["removeItem"] = error }
        let mock = MockAPIClient(fixture: .fridge, behavior: b)
        spy = SpyAPIClient(mock)
        return (FridgeModel(api: spy), mock)
    }
    private func ids(_ m: FridgeModel) -> [String] {
        guard case .content(let secs) = m.state(for: .fridge) else { return [] }
        return secs.flatMap { $0.items.map(\.id) }
    }
    private func item(_ m: FridgeModel, _ id: String) -> Item {
        guard case .content(let secs) = m.state(for: .fridge) else { fatalError("no content") }
        return secs.flatMap(\.items).first { $0.id == id }!
    }
    private func until(_ cond: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        let end = Date().addingTimeInterval(3)
        while Date() < end { if cond() { return }; try? await Task.sleep(for: .milliseconds(20)) }
        XCTFail("condition not met", file: file, line: line)
    }
    /// Lets the background remove task finish (it has no observable success signal).
    private func settle() async { try? await Task.sleep(for: .milliseconds(250)) }

    // MARK: F2

    private func assertRemovalStands(_ error: APIError, file: StaticString = #filePath, line: UInt = #line) async {
        let (m, _) = make(failing: error)
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await settle()
        XCTAssertFalse(ids(m).contains("item-spinach"), "no rollback for \(error)", file: file, line: line)
        XCTAssertNil(m.banner, "no banner for \(error)", file: file, line: line)
        XCTAssertEqual(m.toast?.message, "Baby spinach removed", file: file, line: line)
        XCTAssertTrue(haptics.events.isEmpty, "\(haptics.events)", file: file, line: line)
    }

    func testAlreadyRemoved409CountsAsSuccess() async {
        await assertRemovalStands(.server(status: 409, code: "already_removed", message: "Already removed."))
    }

    func testDecodingErrorOnRemoveCountsAsSuccess() async {
        await assertRemovalStands(.decoding("keyNotFound"))
    }

    private func assertRollsBack(_ error: APIError, file: StaticString = #filePath, line: UInt = #line) async {
        let (m, _) = make(failing: error)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until({ self.ids(m) == before }, file: file, line: line)
        XCTAssertNotNil(m.banner, "banner for \(error)", file: file, line: line)
        XCTAssertNil(m.toast, "toast cleared for \(error)", file: file, line: line)
        XCTAssertEqual(haptics.events, [.error], file: file, line: line)
    }

    func testServer500RollsBack() async { await assertRollsBack(.server(status: 500, code: "internal", message: "boom")) }
    func testNetworkErrorRollsBack() async { await assertRollsBack(.network("offline")) }
    func testOtherConflict409RollsBack() async {
        await assertRollsBack(.server(status: 409, code: "something_else", message: "x"))
    }
    func test404RollsBack() async { await assertRollsBack(.server(status: 404, code: "not_found", message: "x")) }
    func test400RollsBack() async { await assertRollsBack(.server(status: 400, code: "bad_request", message: "x")) }
    func testUnauthorizedRollsBack() async { await assertRollsBack(.unauthorized) }

    /// A single remove that the server answers with 409 already_removed IS removed: the Undo toast stays,
    /// and Undo really calls restore for it.
    func testUndoAfterAlreadyRemovedStillRestores() async {
        let (m, _) = make(failing: .server(status: 409, code: "already_removed", message: "x"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await settle()
        XCTAssertNotNil(m.toast, "the removal stands, so Undo stays offered")
        XCTAssertFalse(ids(m).contains("item-spinach"))
        m.toast?.onUndo()
        XCTAssertEqual(ids(m), before)
        await settle()
        XCTAssertNil(m.banner)
        let restores = await spy.restores
        XCTAssertEqual(restores, ["item-spinach"], "Undo reached the server")
    }

    /// Same for an unreadable 2xx body on a single remove.
    func testUndoAfterDecodingErrorOnRemoveStillRestores() async {
        let (m, _) = make(failing: .decoding("keyNotFound"))
        await m.loadIfNeeded(.fridge)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await settle()
        XCTAssertNotNil(m.toast)
        m.toast?.onUndo()
        await settle()
        let restores = await spy.restores
        XCTAssertEqual(restores, ["item-spinach"])
    }

    /// A batch where nothing failed keeps its Undo toast, and Undo restores through restore-batch.
    func testBatchUndoWhenNothingFailedRestoresViaRestoreBatch() async {
        let (m, _) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        await settle()
        XCTAssertNotNil(m.toast)
        XCTAssertNil(m.banner)
        XCTAssertFalse(ids(m).contains("item-chicken"))
        m.toast?.onUndo()
        await settle()
        XCTAssertEqual(ids(m), before)
        let batch = await spy.batchRestores
        XCTAssertEqual(batch.map(Set.init), [["item-chicken", "item-eggs"]])
        let singles = await spy.restores
        XCTAssertEqual(singles, [])
    }

    // MARK: F1

    func testRetryFromBannerShowsToastImmediatelyAndLeavesNothingPending() async {
        let (m, mock) = make(failing: .network("offline"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { self.ids(m) == before && m.banner != nil }
        await mock.setFailure(nil, for: "removeItem")
        m.banner?.retry?()
        XCTAssertEqual(m.toast?.message, "Baby spinach removed", "shown at once: no sheet will dismiss")
        XCTAssertNil(m.banner)
        // A stale pending toast would reappear here.
        m.toast = nil
        m.showPendingToast()
        XCTAssertNil(m.toast, "pendingToast must be nil after a retry")
    }

    func testFailureBeforeSheetDismissesLeavesNoToast() async {
        // "Cancel after thrown_out": the request fails while the sheet is still up.
        let (m, _) = make(failing: .network("offline"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .thrownOut, wasteReason: .forgot), reduceMotion: false)
        XCTAssertNil(m.toast)
        await until { self.ids(m) == before && m.banner != nil }
        m.showPendingToast()   // the sheet's onDismiss, now late
        XCTAssertNil(m.toast, "no Undo toast for a removal that failed")
        XCTAssertNotNil(m.banner)
    }

    func testRetryThatFailsAgainClearsItsToastAndShowsBannerAgain() async {
        let (m, _) = make(failing: .network("offline"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { self.ids(m) == before && m.banner != nil }
        m.banner = nil
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false, showToastNow: true)
        XCTAssertNotNil(m.toast)
        await until { self.ids(m) == before && m.banner != nil }
        XCTAssertNil(m.toast)
    }

    // MARK: Batch 409 already_removed / decode-after-2xx
    //
    // remove-batch is atomic, so such a request removed NOTHING. The batch's Undo toast is dropped
    // entirely (it must not offer to restore items that were not removed); still-active items come back
    // with the banner; items the server had already removed on its own stay hidden.

    /// Asserts the toast (shown or held) is gone and the stale Undo closure can never call restore.
    /// (Invoking the stale closure directly still re-inserts rows locally; that path is unreachable from the UI
    /// once the toast is nil, so only the server calls are asserted.)
    private func assertNoUndoPossible(_ m: FridgeModel, staleToast: UndoToastItem?, file: StaticString = #filePath, line: UInt = #line) async {
        XCTAssertNil(m.toast, "batch toast dropped", file: file, line: line)
        m.showPendingToast()
        XCTAssertNil(m.toast, "nothing pending either", file: file, line: line)
        staleToast?.onUndo()
        await settle()
        let singles = await spy.restores, batch = await spy.batchRestores
        XCTAssertEqual(singles, [], "Undo can never restore these ids", file: file, line: line)
        XCTAssertEqual(batch, [], "Undo can never restore these ids", file: file, line: line)
    }

    func testBatchAlreadyRemoved409OnlyRestoresItemsTheServerStillHas() async {
        let (m, mock) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        // The server already removed chicken (e.g. from another device); eggs is still active.
        _ = try? await mock.removeItem(id: "item-chicken", outcome: .used, wasteReason: nil)
        await mock.setFailure(.server(status: 409, code: "already_removed", message: "Already removed."), for: "removeBatch")
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        let stale = m.toast
        await until { self.ids(m).contains("item-eggs") && m.banner != nil }
        XCTAssertFalse(ids(m).contains("item-chicken"), "the server removed it: stays hidden")
        XCTAssertEqual(Set(before).subtracting(ids(m)), ["item-chicken"])
        XCTAssertEqual(haptics.events, [.error])
        await assertNoUndoPossible(m, staleToast: stale)
    }

    func testBatchAlreadyRemoved409WhereServerStillHasEveryItemRestoresAll() async {
        let (m, mock) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        await mock.setFailure(.server(status: 409, code: "already_removed", message: "x"), for: "removeBatch")
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        let stale = m.toast
        await until { self.ids(m) == before && m.banner != nil }
        await assertNoUndoPossible(m, staleToast: stale)
    }

    /// The server removed BOTH on its own: nothing comes back, no banner, but still no Undo (nothing was done by us).
    func testBatchAlreadyRemoved409WhereServerRemovedEveryItemKeepsThemHiddenWithoutUndo() async {
        let (m, mock) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        _ = try? await mock.removeItem(id: "item-chicken", outcome: .used, wasteReason: nil)
        _ = try? await mock.removeItem(id: "item-eggs", outcome: .used, wasteReason: nil)
        await mock.setFailure(.server(status: 409, code: "already_removed", message: "x"), for: "removeBatch")
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        let stale = m.toast
        await settle()
        XCTAssertFalse(ids(m).contains("item-chicken")); XCTAssertFalse(ids(m).contains("item-eggs"))
        XCTAssertNil(m.banner, "nothing to roll back")
        await assertNoUndoPossible(m, staleToast: stale)
    }

    func testBatchDecodingErrorReconcilesPerItemToo() async {
        let (m, mock) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        _ = try? await mock.removeItem(id: "item-chicken", outcome: .used, wasteReason: nil)
        await mock.setFailure(.decoding("keyNotFound"), for: "removeBatch")
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        let stale = m.toast
        await until { self.ids(m).contains("item-eggs") && m.banner != nil }
        XCTAssertFalse(ids(m).contains("item-chicken"))
        await assertNoUndoPossible(m, staleToast: stale)
    }

    /// If the server cannot be asked which items are active, nothing is assumed: every item comes back.
    func testBatchAlreadyRemoved409WithUnreadableListingRestoresEverything() async {
        let (m, mock) = make(failing: nil)
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        await mock.setFailure(.server(status: 409, code: "already_removed", message: "x"), for: "removeBatch")
        await mock.setFailure(.network("offline"), for: "listItems")
        m.removeBatch([item(m, "item-chicken"), item(m, "item-eggs")], outcome: .used, reduceMotion: false)
        let stale = m.toast
        await until { self.ids(m) == before && m.banner != nil }
        await assertNoUndoPossible(m, staleToast: stale)
    }
}
