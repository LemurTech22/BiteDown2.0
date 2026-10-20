import XCTest
@testable import FoodWasteReducer

final class AuthStoreTests: XCTestCase {
    private let session = AuthSession(token: "jwt-123", user: MockData.priya)
    private var service = ""

    override func setUp() { service = "com.coderedorion.tests.\(UUID().uuidString)" }
    override func tearDown() { KeychainSessionStorage(service: service).clear() }

    /// Unsigned simulator builds (CODE_SIGNING_ALLOWED=NO, as in CI) have no keychain entitlement:
    /// SecItemAdd returns errSecMissingEntitlement (-34018). Skip rather than fail; see IOS-7.
    private func requireKeychain() throws {
        let probe = KeychainSessionStorage(service: service + ".probe")
        probe.save(session)
        defer { probe.clear() }
        try XCTSkipIf(probe.load() == nil, "Keychain unavailable in this unsigned test host (errSecMissingEntitlement)")
    }

    func testKeychainSaveLoadClear() throws {
        try requireKeychain()
        let kc = KeychainSessionStorage(service: service)
        XCTAssertNil(kc.load())
        kc.save(session)
        XCTAssertEqual(kc.load(), session)
        kc.save(AuthSession(token: "jwt-456", user: MockData.friend))
        XCTAssertEqual(kc.load()?.token, "jwt-456", "save replaces the stored session")
        kc.clear()
        XCTAssertNil(kc.load())
        kc.clear() // idempotent
    }

    func testKeychainServicesAreIsolated() throws {
        try requireKeychain()
        let a = KeychainSessionStorage(service: service), b = KeychainSessionStorage(service: service + ".b")
        defer { b.clear() }
        a.save(session)
        XCTAssertNil(b.load())
    }

    @MainActor func testStorePersistsAcrossInstances() throws {
        try requireKeychain()
        let kc = KeychainSessionStorage(service: service)
        let s1 = AuthStore(storage: kc)
        XCTAssertFalse(s1.isSignedIn)
        s1.signIn(session)
        XCTAssertTrue(s1.isSignedIn)
        XCTAssertEqual(s1.token, "jwt-123")
        XCTAssertEqual(s1.user?.displayName, "Priya")
        let s2 = AuthStore(storage: kc)
        XCTAssertTrue(s2.isSignedIn, "a relaunch restores the session from the Keychain")
        s2.signOut()
        XCTAssertFalse(s2.isSignedIn)
        XCTAssertNil(s2.token)
        XCTAssertFalse(AuthStore(storage: kc).isSignedIn)
    }

    @MainActor func testInMemoryStorageUsedByUITestPathNeverTouchesKeychain() {
        let s = AuthStore(storage: InMemorySessionStorage(session))
        XCTAssertTrue(s.isSignedIn)
        XCTAssertNil(KeychainSessionStorage(service: service).load())
    }

    // MARK: expireSession(ifTokenIs:) (atomic compare-and-expire for 401s)

    @MainActor func testExpireIfTokenIsCurrentExpiresTheSession() {
        let store = InMemorySessionStorage(session)
        let s = AuthStore(storage: store)
        s.expireSession(ifTokenIs: "jwt-123")
        XCTAssertFalse(s.isSignedIn)
        XCTAssertNil(s.token)
        XCTAssertTrue(s.sessionExpired, "SessionExpired is shown")
        XCTAssertNil(store.load(), "the stored session is cleared too")
    }

    @MainActor func testExpireIfTokenIsStaleLeavesTheNewerSessionAlone() {
        let store = InMemorySessionStorage(session)
        let s = AuthStore(storage: store)
        s.signIn(AuthSession(token: "jwt-new", user: MockData.priya))      // signed in again; old request still in flight
        s.expireSession(ifTokenIs: "jwt-123")                              // the stale 401 arrives
        XCTAssertTrue(s.isSignedIn)
        XCTAssertEqual(s.token, "jwt-new")
        XCTAssertFalse(s.sessionExpired)
        XCTAssertEqual(store.load()?.token, "jwt-new", "the stored session is untouched")
    }

    @MainActor func testExpireIfTokenIsNilWhileSignedInIsANoOp() {
        let s = AuthStore(storage: InMemorySessionStorage(session))
        s.expireSession(ifTokenIs: nil)       // a request sent without a token must not expire a session
        XCTAssertTrue(s.isSignedIn)
        XCTAssertEqual(s.token, "jwt-123")
        XCTAssertFalse(s.sessionExpired)
    }

    @MainActor func testExpireIfTokenIsNilWithNoSessionIsANoOp() {
        let s = AuthStore(storage: InMemorySessionStorage(nil))
        XCTAssertFalse(s.isSignedIn)
        s.expireSession(ifTokenIs: nil)
        XCTAssertFalse(s.isSignedIn)
        XCTAssertFalse(s.sessionExpired, "nothing to lose, so no SessionExpired banner")
    }

    @MainActor func testExpireIfTokenIsAfterDeliberateSignOutIsANoOp() {
        let s = AuthStore(storage: InMemorySessionStorage(session))
        s.signOut()
        s.expireSession(ifTokenIs: "jwt-123")
        XCTAssertFalse(s.sessionExpired, "a stale 401 after a deliberate sign-out must not show SessionExpired")
    }
}
