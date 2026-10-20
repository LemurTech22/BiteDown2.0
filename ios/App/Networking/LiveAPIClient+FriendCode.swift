import Foundation

/// Friend QR endpoints (`GET /friends/code`, `POST /friends {code}`). Kept apart from the other
/// friends calls because `addFriend(code:)` needs the HTTP status (201 new friend vs 200 already friends).
extension LiveAPIClient {
    func friendCode() async throws -> FriendCodeInfo {
        let r: FriendCodeInfo = try await send("GET", "/friends/code", body: Optional<Empty>.none)
        return r
    }

    func addFriend(code: String) async throws -> FriendAddResult {
        var comps = URLComponents(url: baseURL.current, resolvingAgainstBaseURL: false)
        comps?.percentEncodedPath += "/friends"
        guard let url = comps?.url else { throw APIError.invalidRequest("Bad API URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try APICoding.encoder.encode(["code": code])
        let usedToken = await auth.token
        if let token = usedToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch is CancellationError { throw CancellationError() }
        catch let e as URLError where e.code == .cancelled { throw CancellationError() }
        catch { throw APIError.network(error.localizedDescription) }
        guard let http = response as? HTTPURLResponse else { throw APIError.network("No HTTP response") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                if await auth.token == usedToken { await auth.signOut() }
                throw APIError.unauthorized
            }
            if let body = try? APICoding.decoder.decode(APIErrorBody.self, from: data) {
                throw APIError.server(status: http.statusCode, code: body.error.code, message: body.error.message)
            }
            throw APIError.server(status: http.statusCode, code: "http_\(http.statusCode)", message: "Request failed (\(http.statusCode)).")
        }
        do {
            let r = try APICoding.decoder.decode(FriendResponse.self, from: data)
            return FriendAddResult(friend: r.friend, alreadyFriends: http.statusCode == 200)
        } catch { throw APIError.decoding(String(describing: error)) }
    }
}
