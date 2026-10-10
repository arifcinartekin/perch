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
  /// The server couldn't be reached at all (offline, DNS, timeout).
  public var isNetwork: Bool { code == "network" }
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

  /// `email` and `emailCode` are needed when the server's signup is `.email`.
  /// `powBits` (from `ServerInfo.pow`) makes it do the proof of work first;
  /// `recoveryCode` is stored (hashed) to reset the password with later.
  public func register(
    username: String, password: String, invite: String?, email: String? = nil,
    emailCode: String? = nil, powBits: Int? = nil, recoveryCode: String? = nil,
    deviceName: String
  ) async throws -> AuthResponse {
    struct Pow: Codable { var challenge, nonce: String }
    struct Challenge: Decodable {
      var challenge: String
      var bits: Int
    }
    struct Body: Encodable {
      var username, authKey, salt: String
      var kdf: KdfParams
      var invite: String?
      var email, emailCode: String?
      var pow: Pow?
      var recoveryCode: String?
      var deviceName: String
    }
    let salt = KeyDerivation.newSalt()
    let kdf = KdfParams.default
    async let keys = KeyDerivation.derive(password: password, salt: salt, params: kdf)
    var pow: Pow?
    if let powBits, powBits > 0 {
      let c: Challenge = try await get("auth/challenge")
      pow = Pow(
        challenge: c.challenge,
        nonce: try await ProofOfWork.solve(challenge: c.challenge, bits: c.bits))
    }
    let code = invite?.trimmingCharacters(in: .whitespaces)
    return try await send(
      "auth/register",
      body: Body(
        username: username, authKey: try await keys.authKey, salt: salt, kdf: kdf,
        invite: code?.isEmpty == false ? code : nil, email: email, emailCode: emailCode,
        pow: pow, recoveryCode: recoveryCode, deviceName: deviceName))
  }

  /// Set a new password with the recovery code. Every other device is signed out.
  public func recover(username: String, recoveryCode: String, password: String, deviceName: String)
    async throws -> AuthResponse
  {
    struct Body: Encodable {
      var username, recoveryCode, authKey, salt: String
      var kdf: KdfParams
      var deviceName: String
    }
    let salt = KeyDerivation.newSalt()
    let kdf = KdfParams.default
    let keys = try await KeyDerivation.derive(password: password, salt: salt, params: kdf)
    return try await send(
      "auth/recover",
      body: Body(
        username: username, recoveryCode: recoveryCode, authKey: keys.authKey, salt: salt,
        kdf: kdf, deviceName: deviceName))
  }

  /// Replace the signed-in account's recovery code, once the password confirms it.
  public func setRecoveryCode(username: String, password: String, code: String) async throws
    -> PublicUser
  {
    struct Prelogin: Decodable {
      var salt: String
      var kdf: KdfParams
    }
    struct Res: Decodable { var user: PublicUser }
    let pre: Prelogin = try await send("auth/prelogin", body: ["username": username])
    let keys = try await KeyDerivation.derive(password: password, salt: pre.salt, params: pre.kdf)
    let res: Res = try await send(
      "auth/recovery", body: ["authKey": keys.authKey, "recoveryCode": code])
    return res.user
  }

  /// Email a 6-digit code. The server answers the same whether or not the
  /// address has an account.
  public func requestEmailCode(email: String, purpose: EmailPurpose, lang: String?) async throws {
    struct Body: Encodable {
      var email: String
      var purpose: EmailPurpose
      var lang: String?
    }
    let _: Ignored = try await send(
      "auth/email/code", body: Body(email: email, purpose: purpose, lang: lang))
  }

  /// Add or change the signed-in account's address with a code sent by
  /// `requestEmailCode(email:purpose: .change, …)`. Returns the updated account.
  public func changeEmail(email: String, code: String) async throws -> PublicUser {
    struct Res: Decodable { var user: PublicUser }
    let res: Res = try await send("auth/email", body: ["email": email, "code": code])
    return res.user
  }

  /// Takes the address off the account. Works whether or not the server sends email.
  public func removeEmail() async throws -> PublicUser {
    struct Res: Decodable { var user: PublicUser }
    let res: Res = try await send("auth/email", method: "DELETE", body: nil as String?)
    return res.user
  }

  /// Set a new password with an emailed code. Every other device is signed out.
  public func resetPassword(email: String, code: String, password: String, deviceName: String)
    async throws -> AuthResponse
  {
    struct Body: Encodable {
      var email, code, authKey, salt: String
      var kdf: KdfParams
      var deviceName: String
    }
    let salt = KeyDerivation.newSalt()
    let kdf = KdfParams.default
    let keys = try await KeyDerivation.derive(password: password, salt: salt, params: kdf)
    return try await send(
      "auth/reset",
      body: Body(
        email: email, code: code, authKey: keys.authKey, salt: salt, kdf: kdf,
        deviceName: deviceName))
  }

  public func me() async throws -> PublicUser {
    struct Me: Decodable { var user: PublicUser }
    let res: Me = try await get("auth/me")
    return res.user
  }

  public func logout() async throws {
    let _: Ignored = try await send("auth/logout", body: [String: String]())
  }

  // MARK: Notes and sharing

  public func notes() async throws -> [Note] {
    struct Res: Decodable { var notes: [Note] }
    let res: Res = try await get("notes")
    return res.notes
  }

  public func saveNote(_ source: NoteSource, body: String) async throws -> Note {
    struct Body: Encodable {
      var title: String
      var url, feedTitle: String?
      var body: String
    }
    struct Res: Decodable { var note: Note }
    let res: Res = try await send(
      "notes/\(source.id.pathSafe)", method: "PUT",
      body: Body(title: source.title, url: source.url, feedTitle: source.feedTitle, body: body))
    return res.note
  }

  public func deleteNote(_ id: String) async throws {
    let _: Ignored = try await send("notes/\(id.pathSafe)", method: "DELETE", body: nil as String?)
  }

  /// Publishes a saved note as a public page; returns its address.
  /// Publishes a note as a public page. With `note` the page is made from it
  /// (a Perch account on a hub); without, from the copy a personal server
  /// already has.
  public func shareNote(_ id: String, note: Note? = nil) async throws -> String {
    struct Res: Decodable { var url: String }
    struct Body: Encodable {
      var title: String
      var url, feedTitle: String?
      var body: String
    }
    let res: Res =
      if let note {
        try await send(
          "shares/\(id.pathSafe)", method: "PUT",
          body: Body(title: note.title, url: note.url, feedTitle: note.feedTitle, body: note.body))
      } else {
        try await send("shares/\(id.pathSafe)", method: "PUT", body: [String: String]())
      }
    return res.url
  }

  public func unshareNote(_ id: String) async throws {
    let _: Ignored = try await send("shares/\(id.pathSafe)", method: "DELETE", body: nil as String?)
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

  /// Keys that changed; the server replaces each one whole.
  public func saveSettings(_ patch: SyncedSettings) async throws -> SyncedSettings {
    struct Res: Decodable { var settings: SyncedSettings }
    let res: Res = try await send("reader/settings", method: "PUT", body: patch)
    return res.settings
  }

  // MARK: Library management

  public struct FeedPatch: Encodable, Sendable {
    public var categoryId: String?
    /// "" clears the custom title.
    public var customTitle: String?
    public init(categoryId: String? = nil, customTitle: String? = nil) {
      self.categoryId = categoryId
      self.customTitle = customTitle
    }
  }

  public func updateFeed(_ id: String, _ patch: FeedPatch) async throws {
    let _: Ignored = try await send("reader/feeds/\(id.pathSafe)", method: "PATCH", body: patch)
  }

  public func addCategory(name: String) async throws -> Category {
    struct Res: Decodable { var category: Category }
    let res: Res = try await send("reader/categories", body: ["name": name])
    return res.category
  }

  public struct CategoryPatch: Encodable, Sendable {
    public var name: String?
    public var collapsed: Bool?
    public init(name: String? = nil, collapsed: Bool? = nil) {
      self.name = name
      self.collapsed = collapsed
    }
  }

  public func updateCategory(_ id: String, _ patch: CategoryPatch) async throws {
    let _: Ignored = try await send(
      "reader/categories/\(id.pathSafe)", method: "PATCH", body: patch)
  }

  /// Its feeds move to Uncategorized.
  public func deleteCategory(_ id: String) async throws {
    let _: Ignored = try await send(
      "reader/categories/\(id.pathSafe)", method: "DELETE", body: nil as String?)
  }

  public func exportOPML() async throws -> Data {
    try await raw("reader/opml", method: "GET")
  }

  public func importOPML(_ data: Data) async throws -> OpmlImportResult {
    try decode(await raw("reader/opml", body: data, contentType: "text/x-opml"))
  }

  // MARK: Account

  /// Re-derives the current key with the account's salt and a new one with a
  /// fresh salt. The server signs out every other device.
  public func changePassword(username: String, current: String, new: String) async throws {
    struct Prelogin: Decodable {
      var salt: String
      var kdf: KdfParams
    }
    struct Body: Encodable {
      var authKey, newAuthKey, salt: String
      var kdf: KdfParams
    }
    let pre: Prelogin = try await send("auth/prelogin", body: ["username": username])
    let old = try await KeyDerivation.derive(password: current, salt: pre.salt, params: pre.kdf)
    let salt = KeyDerivation.newSalt()
    let next = try await KeyDerivation.derive(password: new, salt: salt, params: .default)
    let _: Ignored = try await send(
      "auth/password",
      body: Body(authKey: old.authKey, newAuthKey: next.authKey, salt: salt, kdf: .default))
  }

  /// Deletes the account and everything the server keeps with it, once the
  /// password confirms it.
  public func deleteAccount(username: String, password: String) async throws {
    struct Prelogin: Decodable {
      var salt: String
      var kdf: KdfParams
    }
    let pre: Prelogin = try await send("auth/prelogin", body: ["username": username])
    let keys = try await KeyDerivation.derive(password: password, salt: pre.salt, params: pre.kdf)
    let _: Ignored = try await send("auth/delete", body: ["authKey": keys.authKey])
  }

  public func devices() async throws -> [Device] {
    struct Res: Decodable { var devices: [Device] }
    let res: Res = try await get("devices")
    return res.devices
  }

  public func revokeDevice(_ id: String) async throws {
    let _: Ignored = try await send(
      "devices/\(id.pathSafe)", method: "DELETE", body: nil as String?)
  }

  public func invites() async throws -> [Invite] {
    struct Res: Decodable { var invites: [Invite] }
    let res: Res = try await get("admin/invites")
    return res.invites
  }

  public func createInvite() async throws -> String {
    struct Res: Decodable { var code: String }
    let res: Res = try await send("admin/invites", body: [String: String]())
    return res.code
  }

  public func deleteInvite(_ code: String) async throws {
    let _: Ignored = try await send(
      "admin/invites/\(code.pathSafe)", method: "DELETE", body: nil as String?)
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
    let data = try body.map { try JSONEncoder().encode($0) }
    return try decode(
      await raw(path, method: method, query: query, body: data, contentType: "application/json"))
  }

  private func decode<T: Decodable>(_ data: Data) throws -> T {
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw APIError(
        status: 200, code: "bad-response",
        message: "The server sent a response Perch couldn't read. Is this a Perch server?")
    }
  }

  private func raw(
    _ path: String, method: String = "POST", query: [URLQueryItem] = [], body: Data? = nil,
    contentType: String = "application/json"
  ) async throws -> Data {
    var url = baseURL.appending(path: "api/v1/" + path, directoryHint: .notDirectory)
    if !query.isEmpty { url.append(queryItems: query) }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.timeoutInterval = 60
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      req.setValue(contentType, forHTTPHeaderField: "Content-Type")
      req.httpBody = body
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
    return data
  }
}

extension String {
  fileprivate var pathSafe: String {
    addingPercentEncoding(
      withAllowedCharacters: .urlPathAllowed.subtracting(.init(charactersIn: "/")))
      ?? self
  }
}
