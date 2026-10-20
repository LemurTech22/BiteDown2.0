import Foundation
import Observation
import os
import Security

/// Secure storage for the session. `KeychainSessionStorage` is the real one;
/// `InMemorySessionStorage` is used by the mock/UI-test path so tests never touch the Keychain.
protocol SessionStorage: Sendable {
    func load() -> AuthSession?
    /// Returns false if the session could not be persisted (e.g. Keychain error -34018 in unsigned builds).
    @discardableResult func save(_ session: AuthSession) -> Bool
    func clear()
}

final class InMemorySessionStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: AuthSession?
    init(_ session: AuthSession? = nil) { self.session = session }
    func load() -> AuthSession? { lock.withLock { session } }
    @discardableResult func save(_ session: AuthSession) -> Bool { lock.withLock { self.session = session }; return true }
    func clear() { lock.withLock { session = nil } }
}

struct KeychainSessionStorage: SessionStorage {
    var service = "com.coderedorion.FoodWasteReducer.session"
    private let account = "auth-session"

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func load() -> AuthSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return try? APICoding.decoder.decode(AuthSession.self, from: data)
    }

    @discardableResult
    func save(_ session: AuthSession) -> Bool {
        guard let data = try? APICoding.encoder.encode(session) else { return false }
        SecItemDelete(baseQuery as CFDictionary)
        var add = baseQuery
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess {
            // -34018 (errSecMissingEntitlement) happens in unsigned builds.
            Logger(subsystem: "com.coderedorion.FoodWasteReducer", category: "auth")
                .error("Keychain save failed, OSStatus \(status)")
        }
        return status == errSecSuccess
    }

    func clear() { SecItemDelete(baseQuery as CFDictionary) }
}

/// Holds the bearer token and current user. A 401 from `LiveAPIClient` calls `signOut()`,
/// which flips `isSignedIn` so the UI can show the signed-out state.
@MainActor
@Observable
final class AuthStore {
    private(set) var session: AuthSession?
    /// True if the last sign-in could not be stored; the session lives in memory only (signed out on relaunch).
    private(set) var persistenceFailed = false
    /// True after a global 401 (`expireSession()`), cleared by the next sign-in or a deliberate sign-out.
    /// The app root reads it to show the "You were signed out" state instead of the plain landing.
    private(set) var sessionExpired = false
    private let storage: SessionStorage

    var token: String? { session?.token }
    var user: User? { session?.user }
    var isSignedIn: Bool { session != nil }

    init(storage: SessionStorage = KeychainSessionStorage()) {
        self.storage = storage
        self.session = storage.load()
    }

    func signIn(_ session: AuthSession) {
        sessionExpired = false
        self.session = session
        persistenceFailed = !storage.save(session)
    }

    /// Deliberate sign-out (Settings > Log out, account deletion): clears the Keychain token.
    func signOut() {
        sessionExpired = false
        session = nil
        storage.clear()
    }

    /// A 401 on an authenticated call: clears the token like `signOut()`, and tells the app root the
    /// session ran out (only when there was a session to lose).
    func expireSession() {
        let hadSession = session != nil
        session = nil
        storage.clear()
        if hadSession { sessionExpired = true }
    }

    /// Like `expireSession()`, but only if the current session still uses `token`. The check and the
    /// expiry happen in one synchronous call, so a sign-in can't land between them and lose to a
    /// stale 401 from the previous session.
    func expireSession(ifTokenIs token: String?) {
        guard session?.token == token else { return }
        expireSession()
    }
}
