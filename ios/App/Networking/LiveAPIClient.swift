import Foundation

/// URLSession-backed client. The base URL is read from `BaseURLProvider` on every request, so the
/// Debug settings sheet can repoint it (e.g. at a new Cloudflare tunnel) without a rebuild.
final class LiveAPIClient: APIClient {
    let baseURL: BaseURLProvider
    let session: URLSession
    let auth: AuthStore

    init(baseURL: BaseURLProvider = BaseURLProvider(),
         auth: AuthStore,
         session: URLSession = LiveAPIClient.makeSession()) {
        self.baseURL = baseURL
        self.auth = auth
        self.session = session
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    // MARK: Auth

    func signup(email: String, password: String, displayName: String) async throws -> AuthSession {
        let s: AuthSession = try await send("POST", "/auth/signup", body: Credentials(email: email, password: password, displayName: displayName), authenticated: false)
        await auth.signIn(s)
        return s
    }

    func login(email: String, password: String) async throws -> AuthSession {
        let s: AuthSession = try await send("POST", "/auth/login", body: Credentials(email: email, password: password, displayName: nil), authenticated: false)
        await auth.signIn(s)
        return s
    }

    func deleteAccount() async throws {
        let _: Empty = try await send("DELETE", "/auth/me", body: Optional<Empty>.none)
        await auth.signOut()
    }

    // MARK: Items

    func listItems(storage: Storage?, groupBy: ItemGrouping?) async throws -> ItemListing {
        var q: [URLQueryItem] = []
        if let storage { q.append(.init(name: "storage", value: storage.rawValue)) }
        if let groupBy { q.append(.init(name: "group_by", value: groupBy.rawValue)) }
        if groupBy != nil {
            let r: SectionsResponse = try await send("GET", "/items", query: q, body: Optional<Empty>.none)
            return .grouped(r.sections)
        }
        let r: ItemsResponse = try await send("GET", "/items", query: q, body: Optional<Empty>.none)
        return .flat(r.items)
    }

    func createItems(_ items: [NewItem]) async throws -> [Item] {
        let r: ItemsResponse = try await send("POST", "/items", body: CreateItemsRequest(items: items, groupId: nil))
        return r.items
    }

    func patchItem(id: String, _ patch: ItemPatch) async throws -> Item {
        let r: ItemResponse = try await send("PATCH", "/items/\(Self.ids(id))", body: patch)
        return r.item
    }

    func removeItem(id: String, outcome: RemoveOutcome, wasteReason: WasteReason?, recipient: RecipientChoice) async throws -> Item {
        let r: ItemResponse = try await send("POST", "/items/\(Self.ids(id))/remove",
                                             body: RemoveBody(outcome: outcome, wasteReason: wasteReason, recipient: recipient))
        return r.item
    }

    func restoreItem(id: String) async throws -> Item {
        let r: ItemResponse = try await send("POST", "/items/\(Self.ids(id))/restore", body: Optional<Empty>.none)
        return r.item
    }

    // MARK: Adding food

    func fromPhoto(imageData: Data, mode: PhotoMode) async throws -> CandidatesResponse {
        let (body, contentType) = LiveAPIClient.multipart(fields: [("mode", mode.rawValue)], imageData: imageData)
        return try await perform("POST", "/items/from-photo", query: [], rawBody: body, contentType: contentType, authenticated: true)
    }

    func parseText(_ text: String) async throws -> [Candidate] {
        let r: CandidatesResponse = try await send("POST", "/items/parse-text", body: ["text": text])
        return r.candidates
    }

    // MARK: Insights

    func impact(range: ImpactRange) async throws -> Impact {
        try await send("GET", "/impact", query: [.init(name: "range", value: range.rawValue)], body: Optional<Empty>.none)
    }

    func tips() async throws -> [Tip] {
        let r: TipsResponse = try await send("GET", "/tips", body: Optional<Empty>.none)
        return r.tips
    }

    func recipesSuggest(maxResults: Int?, dietary: [String]?) async throws -> [Recipe] {
        let r: RecipesResponse = try await send("POST", "/recipes/suggest",
                                                body: RecipeSuggestRequest(maxResults: maxResults, dietary: dietary))
        return r.recipes
    }

    // MARK: Transport

    struct Empty: Codable {}
    private struct Credentials: Encodable { let email: String; let password: String; let displayName: String? }

    func send<T: Decodable, B: Encodable>(_ method: String, _ path: String,
                                                  query: [URLQueryItem] = [], body: B?,
                                                  authenticated: Bool = true) async throws -> T {
        let raw = try body.map { try APICoding.encoder.encode($0) }
        return try await perform(method, path, query: query, rawBody: raw, contentType: "application/json", authenticated: authenticated)
    }

    func perform<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem],
                                       rawBody: Data?, contentType: String, authenticated: Bool,
                                       timeout: TimeInterval? = nil) async throws -> T {
        let base = baseURL.current
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw APIError.invalidRequest("Bad API URL") }
        comps.percentEncodedPath += path
        comps.queryItems = query.isEmpty ? nil : query
        guard let url = comps.url else { throw APIError.invalidRequest("Bad API URL") }

        var req = URLRequest(url: url)
        req.httpMethod = method
        if let timeout { req.timeoutInterval = timeout }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let rawBody {
            req.httpBody = rawBody
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let usedToken: String? = authenticated ? await auth.token : nil
        if let token = usedToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // A longer per-request timeout also needs a longer session idle timeout (the session default is 30 s).
        var requestSession = session
        if let timeout, session.configuration.timeoutIntervalForRequest < timeout {
            let config = session.configuration
            config.timeoutIntervalForRequest = timeout
            config.timeoutIntervalForResource = max(config.timeoutIntervalForResource, timeout + 30)
            requestSession = URLSession(configuration: config)
        }
        defer { if requestSession !== session { requestSession.finishTasksAndInvalidate() } }
        let data: Data, response: URLResponse
        do { (data, response) = try await requestSession.data(for: req) }
        catch is CancellationError { throw CancellationError() }
        catch let e as URLError where e.code == .cancelled { throw CancellationError() }
        catch { throw APIError.network(error.localizedDescription) }

        guard let http = response as? HTTPURLResponse else { throw APIError.network("No HTTP response") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 && authenticated {
                // Only if the session that made this request is still current (a newer sign-in survives).
                if await auth.token == usedToken { await auth.expireSession() }
                throw APIError.unauthorized
            }
            if let body = try? APICoding.decoder.decode(APIErrorBody.self, from: data) {
                switch body.error.code {
                case "not_removed": throw APIError.notRemoved
                case "restore_window_expired": throw APIError.restoreWindowExpired
                default: throw APIError.server(status: http.statusCode, code: body.error.code, message: body.error.message)
                }
            }
            throw APIError.server(status: http.statusCode, code: "http_\(http.statusCode)", message: "Request failed (\(http.statusCode)).")
        }
        if T.self == Empty.self || data.isEmpty, let empty = Empty() as? T { return empty }
        do { return try APICoding.decoder.decode(T.self, from: data) }
        catch { throw APIError.decoding(String(describing: error)) }
    }
}
