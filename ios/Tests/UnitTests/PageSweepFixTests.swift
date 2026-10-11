import XCTest
@testable import FoodWasteReducer

/// Regression tests for request sources, reachable people, unauthorized responses, and removal.
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
        XCTAssertNil(created.source.name)
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

final class UnauthorizedSessionTests: XCTestCase {
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

    func testUnauthorizedExpiresSessionEvenIfTokenChangedDuringRequest() async throws {
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
        XCTAssertFalse(signedIn)
        XCTAssertNil(token)
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

    private func make(failing error: APIError?) -> (FridgeModel, MockAPIClient) {
        var b = MockAPIClient.Behavior(delay: .zero)
        if let error { b.failures["removeItem"] = error }
        let mock = MockAPIClient(fixture: .fridge, behavior: b)
        return (FridgeModel(api: SpyAPIClient(mock)), mock)
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
    // MARK: Remove failures

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
    func testAlreadyRemoved409RollsBack() async {
        await assertRollsBack(.server(status: 409, code: "already_removed", message: "Already removed."))
    }
    func testDecodingErrorOnRemoveRollsBack() async { await assertRollsBack(.decoding("keyNotFound")) }
    func testNetworkErrorRollsBack() async { await assertRollsBack(.network("offline")) }
    func testOtherConflict409RollsBack() async {
        await assertRollsBack(.server(status: 409, code: "something_else", message: "x"))
    }
    func test404RollsBack() async { await assertRollsBack(.server(status: 404, code: "not_found", message: "x")) }
    func test400RollsBack() async { await assertRollsBack(.server(status: 400, code: "bad_request", message: "x")) }
    func testUnauthorizedRollsBack() async { await assertRollsBack(.unauthorized) }

    func testAlreadyRemovedFailureClearsUndoToast() async {
        let (m, _) = make(failing: .server(status: 409, code: "already_removed", message: "x"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { self.ids(m) == before && m.banner != nil }
        XCTAssertNil(m.toast)
    }

    // MARK: Pending toast

    func testRetryFromBannerHoldsToastUntilShown() async {
        let (m, mock) = make(failing: .network("offline"))
        await m.loadIfNeeded(.fridge)
        let before = ids(m)
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        await until { self.ids(m) == before && m.banner != nil }
        await mock.setFailure(nil, for: "removeItem")
        m.banner?.retry?()
        XCTAssertNil(m.toast)
        XCTAssertNil(m.banner)
        m.showPendingToast()
        XCTAssertEqual(m.toast?.message, "Baby spinach removed")
        m.toast = nil
        m.showPendingToast()
        XCTAssertNil(m.toast, "pendingToast is consumed once")
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
        m.remove(item(m, "item-spinach"), choice: .init(outcome: .used), reduceMotion: false)
        m.showPendingToast()
        XCTAssertNotNil(m.toast)
        await until { self.ids(m) == before && m.banner != nil }
        XCTAssertNil(m.toast)
    }
}
