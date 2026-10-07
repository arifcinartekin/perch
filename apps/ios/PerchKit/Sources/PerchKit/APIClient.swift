import Foundation

/// An error from the server (`{ error, message }`) or the network.
public struct APIError: Error, LocalizedError, Sendable {
  public var status: Int
  /// The server's machine-readable code, e.g. `invalid-credentials`.
  public var code: String
  public var message: String

  public init(status: Int, code: String, message: String) {
    self.status = status
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
  public var isUnauthorized: Bool { status == 401 }
}

/// The Perch Server HTTP API (/api/v1) for one server and, once signed in, one
/// session. Sessions use `Authorization: Bearer`.
public final class APIClient: Sendable {
  public let baseURL: URL
  public let token: String?
  private let session: URLSession

  public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.token = token
    self.session = session
  }

  public func signedIn(_ token: String) -> APIClient {
    APIClient(baseURL: baseURL, token: token, session: session)
  }

  /// Turns what a person types ("perch.example.com", "http://192.168.1.5:8080/")
  /// into a server URL: https by default, no trailing slash or path.
  public static func normalizeServerURL(_ input: String) -> URL? {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    if !text.contains("://") { text = "https://" + text }
    guard var parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(),
      scheme == "http" || scheme == "https", let host = parts.host, !host.isEmpty
    else { return nil }
    parts.scheme = scheme
    parts.path = ""
    parts.query = nil
    parts.fragment = nil
    return parts.url
  }

  // MARK: Server and accounts

  public func serverInfo() async throws -> ServerInfo {
    try await get("server")
  }

  /// Prelogin, Argon2id, then login. The password never leaves the device.
  public func login(username: String, password: String, deviceName: String) async throws
    -> AuthResponse
  {
    struct Prelogin: Decodable {
      var salt: String
      var kdf: KdfParams
    }
    let pre: Prelogin = try await send("auth/prelogin", body: ["username": username])
    let keys = try await KeyDerivation.derive(password: password, salt: pre.salt, params: pre.kdf)
    return try await send(
      "auth/login",
      body: ["username": username, "authKey": keys.authKey, "deviceName": deviceName])
  }

  public func register(username: String, password: String, invite: String?, deviceName: String)
    async throws -> AuthResponse
  {
    struct Body: Encodable {
      var username, authKey, salt: String
      var kdf: KdfParams
      var invite: String?
      var deviceName: String
    }
    let salt = KeyDerivation.newSalt()
    let kdf = KdfParams.default
    let keys = try await KeyDerivation.derive(password: password, salt: salt, params: kdf)
    let code = invite?.trimmingCharacters(in: .whitespaces)
    return try await send(
      "auth/register",
      body: Body(
        username: username, authKey: keys.authKey, salt: salt, kdf: kdf,
        invite: code?.isEmpty == false ? code : nil, deviceName: deviceName))
  }

  public func me() async throws -> PublicUser {
    struct Me: Decodable { var user: PublicUser }
    let res: Me = try await get("auth/me")
    return res.user
  }

  public func logout() async throws {
    let _: Ignored = try await send("auth/logout", body: [String: String]())
  }

  // MARK: Reader

  public func library() async throws -> Library { try await get("reader/library") }
  public func counts() async throws -> Counts { try await get("reader/counts") }

  public struct ArticleQuery: Sendable, Hashable {
    public var feed: String?
    public var category: String?
    public var unreadOnly = false
    public var starred = false
    public var search: String?
    public init(
      feed: String? = nil, category: String? = nil, unreadOnly: Bool = false,
      starred: Bool = false, search: String? = nil
    ) {
      self.feed = feed
      self.category = category
      self.unreadOnly = unreadOnly
      self.starred = starred
      self.search = search
    }
  }

  public func articles(_ q: ArticleQuery, before: String? = nil, limit: Int = 50) async throws
    -> ArticlePage
  {
    var items = [URLQueryItem(name: "limit", value: String(limit))]
    if let feed = q.feed { items.append(.init(name: "feed", value: feed)) }
    if let category = q.category { items.append(.init(name: "category", value: category)) }
    if q.unreadOnly { items.append(.init(name: "unread", value: "1")) }
    if q.starred { items.append(.init(name: "starred", value: "1")) }
    if let s = q.search, !s.isEmpty { items.append(.init(name: "q", value: s)) }
    if let before { items.append(.init(name: "before", value: before)) }
    return try await get("reader/articles", query: items)
  }

  public func fullText(_ ref: ArticleRef, force: Bool = false) async throws -> FullText {
    struct Res: Decodable { var fullText: FullText }
    let res: Res = try await get(
      "reader/articles/\(ref.feedId.pathSafe)/\(ref.id.pathSafe)/fulltext",
      query: force ? [.init(name: "force", value: "1")] : [])
    return res.fullText
  }

  public func setState(_ refs: [ArticleRef], read: Bool? = nil, starred: Bool? = nil) async throws {
    struct Body: Encodable {
      var items: [ArticleRef]
      var read: Bool?
      var starred: Bool?
    }
    let _: Ignored = try await send(
      "reader/articles/state", body: Body(items: refs, read: read, starred: starred))
  }

  public func markAllRead(feed: String? = nil, category: String? = nil, upTo: Date = .now)
    async throws
  {
    struct Body: Encodable {
      var feed: String?
      var category: String?
      var upTo: Double
    }
    let _: Ignored = try await send(
      "reader/articles/read-all",
      body: Body(
        feed: feed, category: category, upTo: (upTo.timeIntervalSince1970 * 1000).rounded()))
  }

  /// Fetches feeds now: one, several, or (nil) everything you subscribe to.
  public func refresh(feeds: [String]? = nil) async throws {
    struct Body: Encodable { var feeds: [String]? }
    let _: Ignored = try await send("reader/refresh", body: Body(feeds: feeds))
  }

  public struct AddFeedResult: Decodable, Sendable {
    public var feed: Feed
    public var created: Bool
  }

  public func addFeed(url: String, categoryId: String? = nil) async throws -> AddFeedResult {
    struct Body: Encodable {
      var url: String
      var categoryId: String?
    }
    return try await send("reader/feeds", body: Body(url: url, categoryId: categoryId))
  }

  public func removeFeed(_ id: String) async throws {
    let _: Ignored = try await send(
      "reader/feeds/\(id.pathSafe)", method: "DELETE", body: nil as String?)
  }

  public func settings() async throws -> SyncedSettings {
    struct Res: Decodable { var settings: SyncedSettings }
    let res: Res = try await get("reader/settings")
    return res.settings
  }

  // MARK: Plumbing

  private struct Ignored: Decodable {}
  private struct ErrorBody: Decodable {
    var error: String?
    var message: String?
  }

  private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
    try await send(path, method: "GET", query: query, body: nil as String?)
  }

  private func send<T: Decodable, B: Encodable>(
    _ path: String, method: String = "POST", query: [URLQueryItem] = [], body: B?
  ) async throws -> T {
    var url = baseURL.appending(path: "api/v1/" + path, directoryHint: .notDirectory)
    if !query.isEmpty { url.append(queryItems: query) }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.timeoutInterval = 60
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONEncoder().encode(body)
    }

    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await session.data(for: req)
    } catch let error as URLError {
      throw APIError(status: 0, code: "network", message: error.localizedDescription)
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
      throw APIError(
        status: status, code: body?.error ?? "http-\(status)",
        message: body?.message ?? body?.error
          ?? HTTPURLResponse.localizedString(forStatusCode: status))
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw APIError(
        status: status, code: "bad-response",
        message: "The server sent a response Perch couldn't read. Is this a Perch server?")
    }
  }
}

extension String {
  fileprivate var pathSafe: String {
    addingPercentEncoding(
      withAllowedCharacters: .urlPathAllowed.subtracting(.init(charactersIn: "/")))
      ?? self
  }
}
