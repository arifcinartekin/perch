import Foundation
import SQLite3

/// A read or star change made on this device that the server hasn't seen yet.
public struct PendingState: Codable, Sendable, Hashable {
  public var ref: ArticleRef
  public var read: Bool?
  public var starred: Bool?
}

/// Everything needed to read offline, for one account: the last library,
/// counts and settings, recent articles with their full text, and state
/// changes waiting for the server. One SQLite file (the system's libsqlite3).
public actor OfflineStore {
  public struct Snapshot: Codable, Sendable {
    public var library = Library()
    public var counts = Counts()
    public var settings = SyncedSettings()
    public var savedAt: Double = 0
    public init() {}
  }

  public struct Query: Sendable {
    /// nil = every feed.
    public var feedIds: Set<String>?
    public var unreadOnly = false
    public var starred = false
    public var search = ""
    public init(
      feedIds: Set<String>? = nil, unreadOnly: Bool = false, starred: Bool = false,
      search: String = ""
    ) {
      self.feedIds = feedIds
      self.unreadOnly = unreadOnly
      self.starred = starred
      self.search = search
    }
  }

  // Only touched on the actor, and in deinit when nothing else can.
  nonisolated(unsafe) private let db: OpaquePointer?
  public let url: URL

  public init(url: URL) throws {
    self.url = url
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var handle: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
    guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK else {
      sqlite3_close(handle)
      throw StoreError.open
    }
    db = handle
    for sql in Self.schema { try Self.exec(handle, sql) }
  }

  deinit { sqlite3_close(db) }

  public enum StoreError: Error {
    case open
    case sql(String)
  }

  private static let schema = [
    "PRAGMA journal_mode=WAL",
    """
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, published_at REAL NOT NULL,
      read INTEGER NOT NULL, starred INTEGER NOT NULL, search TEXT NOT NULL,
      json BLOB NOT NULL, stored_at REAL NOT NULL)
    """,
    "CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at DESC)",
    "CREATE TABLE IF NOT EXISTS fulltext (id TEXT PRIMARY KEY, json BLOB NOT NULL)",
    """
    CREATE TABLE IF NOT EXISTS pending (
      id TEXT PRIMARY KEY, json BLOB NOT NULL, at REAL NOT NULL)
    """,
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json BLOB NOT NULL)",
  ]

  // MARK: Snapshot

  public func snapshot() -> Snapshot? {
    value(forKey: "snapshot")
  }

  public func saveSnapshot(library: Library, counts: Counts, settings: SyncedSettings) {
    var s = Snapshot()
    s.library = library
    s.counts = counts
    s.settings = settings
    s.savedAt = Date.now.timeIntervalSince1970 * 1000
    setValue(s, forKey: "snapshot")
  }

  public func saveCounts(_ counts: Counts) {
    guard var s = snapshot() else { return }
    s.counts = counts
    setValue(s, forKey: "snapshot")
  }

  // MARK: Articles

  /// Stores articles from the server. Changes still waiting to be sent win
  /// over the server's state, so a stale page can't undo them.
  public func store(_ articles: [Article]) {
    guard !articles.isEmpty else { return }
    let pending = pendingByID()
    let now = Date.now.timeIntervalSince1970
    transaction {
      for var a in articles {
        if let p = pending[a.id] {
          if let r = p.read { a.read = r }
          if let s = p.starred { a.starred = s }
        }
        run(
          """
          INSERT INTO articles (id, feed_id, published_at, read, starred, search, json, stored_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET read = excluded.read, starred = excluded.starred,
            json = excluded.json, search = excluded.search, stored_at = excluded.stored_at
          """,
          .text(a.id), .text(a.feedId), .double(a.publishedAt), .int(a.read ? 1 : 0),
          .int(a.starred ? 1 : 0), .text(Self.searchText(a)), .blob(Self.encode(a)), .double(now))
      }
    }
  }

  public func article(_ id: String) -> Article? {
    first("SELECT json FROM articles WHERE id = ?", .text(id))
  }

  /// Newest first, like the server's list.
  public func articles(_ q: Query, before: Double? = nil, limit: Int = 50) -> [Article] {
    var sql = "SELECT json FROM articles WHERE 1"
    var args: [Value] = []
    if let ids = q.feedIds {
      if ids.isEmpty { return [] }
      sql += " AND feed_id IN (\(Array(repeating: "?", count: ids.count).joined(separator: ",")))"
      args += ids.sorted().map(Value.text)
    }
    if q.unreadOnly { sql += " AND read = 0" }
    if q.starred { sql += " AND starred = 1" }
    for term in Self.fold(q.search).split(separator: " ").prefix(10) {
      sql += " AND search LIKE ? ESCAPE '\\'"
      let escaped = term.replacing("\\", with: "\\\\").replacing("%", with: "\\%")
        .replacing("_", with: "\\_")
      args.append(.text("%\(escaped)%"))
    }
    if let before {
      sql += " AND published_at < ?"
      args.append(.double(before))
    }
    sql += " ORDER BY published_at DESC LIMIT ?"
    args.append(.int(limit))
    return all(sql, args)
  }

  public func setState(_ id: String, read: Bool? = nil, starred: Bool? = nil) {
    guard var a = article(id) else { return }
    if let read { a.read = read }
    if let starred { a.starred = starred }
    run(
      "UPDATE articles SET read = ?, starred = ?, json = ? WHERE id = ?",
      .int(a.read ? 1 : 0), .int(a.starred ? 1 : 0), .blob(Self.encode(a)), .text(id))
  }

  /// Marks stored articles read, as the server did for "mark all read".
  public func markRead(feedIds: Set<String>?, upTo: Double) {
    for a in articles(Query(feedIds: feedIds, unreadOnly: true), limit: 100_000)
    where a.publishedAt <= upTo {
      setState(a.id, read: true)
    }
  }

  /// Unread and starred articles the device knows of, for offline counts.
  public func unreadCounts() -> [String: Int] {
    var out: [String: Int] = [:]
    for (feed, n) in pairs("SELECT feed_id, COUNT(*) FROM articles WHERE read = 0 GROUP BY feed_id")
    {
      out[feed] = n
    }
    return out
  }

  // MARK: Full text

  public func fullText(_ id: String) -> FullText? {
    first("SELECT json FROM fulltext WHERE id = ?", .text(id))
  }

  public func saveFullText(_ text: FullText, for id: String) {
    run(
      "INSERT OR REPLACE INTO fulltext (id, json) VALUES (?, ?)", .text(id),
      .blob(Self.encode(text)))
  }

  // MARK: Pending changes

  public func enqueue(_ ref: ArticleRef, read: Bool? = nil, starred: Bool? = nil) {
    let id = "\(ref.feedId):\(ref.id)"
    var p = pendingByID()[id] ?? PendingState(ref: ref)
    if let read { p.read = read }
    if let starred { p.starred = starred }
    run(
      "INSERT OR REPLACE INTO pending (id, json, at) VALUES (?, ?, ?)", .text(id),
      .blob(Self.encode(p)), .double(Date.now.timeIntervalSince1970))
  }

  public func pending() -> [PendingState] {
    all("SELECT json FROM pending ORDER BY at", [])
  }

  public func clearPending(_ states: [PendingState]) {
    transaction {
      for p in states {
        run("DELETE FROM pending WHERE id = ?", .text("\(p.ref.feedId):\(p.ref.id)"))
      }
    }
  }

  private func pendingByID() -> [String: PendingState] {
    Dictionary(pending().map { ("\($0.ref.feedId):\($0.ref.id)", $0) }) { _, b in b }
  }

  // MARK: Housekeeping

  /// Keeps the newest `keep` articles plus every starred and unsent one.
  public func trim(keep: Int) {
    run(
      """
      DELETE FROM articles WHERE starred = 0
        AND id NOT IN (SELECT id FROM pending)
        AND id NOT IN (SELECT id FROM articles ORDER BY published_at DESC LIMIT ?)
      """, .int(keep))
    run("DELETE FROM fulltext WHERE id NOT IN (SELECT id FROM articles)")
  }

  public func articleCount() -> Int {
    pairs("SELECT 'n', COUNT(*) FROM articles").first?.1 ?? 0
  }

  /// Drops everything except changes that still have to reach the server.
  public func clear() {
    transaction {
      run("DELETE FROM articles WHERE id NOT IN (SELECT id FROM pending)")
      run("DELETE FROM fulltext")
    }
    run("VACUUM")
  }

  public func sizeOnDisk() -> Int {
    ["", "-wal", "-shm"].reduce(0) { total, suffix in
      let path = url.path + suffix
      let attributes = try? FileManager.default.attributesOfItem(atPath: path)
      return total + ((attributes?[.size] as? Int) ?? 0)
    }
  }

  // MARK: Search text

  /// Title, author and text, lowercased without accents (like core/search.ts).
  static func searchText(_ a: Article) -> String {
    let body = HTMLText.plain(a.contentHtml ?? a.summaryHtml ?? "", limit: 4000)
    return fold([a.displayTitle, a.author ?? "", body].joined(separator: " "))
  }

  static func fold(_ s: String) -> String {
    s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
      .replacing("ı", with: "i")
  }

  // MARK: SQLite

  enum Value {
    case text(String)
    case int(Int)
    case double(Double)
    case blob(Data)
  }

  private static func encode<T: Encodable>(_ value: T) -> Data {
    (try? JSONEncoder().encode(value)) ?? Data()
  }

  private func value<T: Decodable>(forKey key: String) -> T? {
    first("SELECT json FROM kv WHERE key = ?", .text(key))
  }

  private func setValue<T: Encodable>(_ value: T, forKey key: String) {
    run(
      "INSERT OR REPLACE INTO kv (key, json) VALUES (?, ?)", .text(key), .blob(Self.encode(value)))
  }

  private static func exec(_ db: OpaquePointer?, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
      throw StoreError.sql(String(cString: sqlite3_errmsg(db)))
    }
  }

  private func transaction(_ body: () -> Void) {
    sqlite3_exec(db, "BEGIN", nil, nil, nil)
    body()
    sqlite3_exec(db, "COMMIT", nil, nil, nil)
  }

  private func prepare(_ sql: String, _ args: [Value]) -> OpaquePointer? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
    // SQLITE_TRANSIENT: SQLite copies the bytes before we return.
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (i, arg) in args.enumerated() {
      let n = Int32(i + 1)
      switch arg {
      case .text(let s): sqlite3_bind_text(stmt, n, s, -1, transient)
      case .int(let v): sqlite3_bind_int64(stmt, n, Int64(v))
      case .double(let v): sqlite3_bind_double(stmt, n, v)
      case .blob(let d):
        d.withUnsafeBytes { p in
          _ = sqlite3_bind_blob(stmt, n, p.baseAddress, Int32(d.count), transient)
        }
      }
    }
    return stmt
  }

  @discardableResult
  private func run(_ sql: String, _ args: Value...) -> Bool {
    guard let stmt = prepare(sql, args) else { return false }
    defer { sqlite3_finalize(stmt) }
    return sqlite3_step(stmt) == SQLITE_DONE
  }

  private func all<T: Decodable>(_ sql: String, _ args: [Value]) -> [T] {
    guard let stmt = prepare(sql, args) else { return [] }
    defer { sqlite3_finalize(stmt) }
    var out: [T] = []
    let decoder = JSONDecoder()
    while sqlite3_step(stmt) == SQLITE_ROW {
      guard let bytes = sqlite3_column_blob(stmt, 0) else { continue }
      let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, 0)))
      if let value = try? decoder.decode(T.self, from: data) { out.append(value) }
    }
    return out
  }

  private func first<T: Decodable>(_ sql: String, _ args: Value...) -> T? {
    (all(sql, args) as [T]).first
  }

  private func pairs(_ sql: String) -> [(String, Int)] {
    guard let stmt = prepare(sql, []) else { return [] }
    defer { sqlite3_finalize(stmt) }
    var out: [(String, Int)] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      let key = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? ""
      out.append((key, Int(sqlite3_column_int64(stmt, 1))))
    }
    return out
  }
}
