import Foundation
import Testing

@testable import PerchKit

// Sync chains: the code, keys and record format against the TypeScript
// implementation's vectors (packages/core/tests/chain.test.ts), and the
// engine syncing two on-device libraries through an in-memory relay.

private let secret = Data(0..<16)
private let vectorCode = "000G-40R4-0M30-E209-185G-R38E-1X0G"
private let vectorToken = "Y7Wa6yDxEtxEAWukDZMuf1kN_qolwFQsyKiC0HFs4yc"
private let vectorSlot = "Oa4CSVR2mEEhKd_BDVYZIg"
/// Sealed by the TypeScript code: category c1 {name Tech, order 10}, zero IV.
private let tsSealed = ChainRecord(
  key: "U4YedoXC32m-kxquAb7kPw", hlc: "1700000000000-0000-dev", deleted: false, ephemeral: false,
  blob:
    "AAAAAAAAAAAAAAAAYN2WqZ-YeQEmyPspk5ypEYB_wPPazHR7zD85Frue6sX_1tx6Sm5aBKUglkS7EoZ12nv9pEHyBWOggu34aEjDNetU_QF_oCpPFG1zctf-QYbUP0zndg4WgCbTL3W44zKOIw",
  version: 1)

@Suite struct ChainCodeTests {
  @Test func matchesTheTypeScriptVectors() {
    #expect(ChainCode.format(secret) == vectorCode)
    let keys = ChainKeys(secret: secret)
    #expect(keys.token == vectorToken)
    #expect(keys.slot(type: "feed", id: "abc123") == vectorSlot)
  }

  @Test func roundTripsAndForgivesTyping() {
    for _ in 0..<50 {
      let s = ChainCode.newSecret()
      #expect(ChainCode.parse(ChainCode.format(s)) == s)
    }
    let typed = vectorCode.lowercased().replacingOccurrences(of: "-", with: " ")
      .replacingOccurrences(of: "0", with: "o").replacingOccurrences(of: "1", with: "l")
    #expect(ChainCode.parse(typed) == secret)
    #expect(ChainCode.normalize(" \(typed) ") == vectorCode)
  }

  @Test func rejectsTyposAndWrongLengths() {
    let chars = Array(vectorCode.replacingOccurrences(of: "-", with: ""))
    var typo = chars
    typo[5] = typo[5] == "A" ? "B" : "A"
    #expect(ChainCode.parse(String(typo)) == nil)
    #expect(ChainCode.parse(String(chars.dropFirst())) == nil)
    #expect(ChainCode.parse(String(chars) + "0") == nil)
    #expect(ChainCode.parse("not a code at all, sorry!!") == nil)
  }

  @Test func links() throws {
    let server = try #require(URL(string: "https://sync.example.com"))
    let link = ChainCode.link(server: server, code: vectorCode)
    #expect(link.scheme == "perch")
    let parsed = try #require(ChainCode.parseLink(link))
    #expect(parsed.server == server)
    #expect(parsed.code == vectorCode)
    // The TypeScript link format.
    let ts = try #require(
      URL(string: "perch://chain?server=https%3A%2F%2Fsync.perch.ws&code=\(vectorCode)"))
    #expect(ChainCode.parseLink(ts)?.server == ChainCode.defaultServer)
    #expect(ChainCode.parseLink(URL(string: "perch://chain?code=nope")!) == nil)
    #expect(ChainCode.parseLink(URL(string: "perch://unread")!) == nil)
  }
}

@Suite struct ChainRecordTests {
  @Test func opensWhatTypeScriptSealed() throws {
    let record = try #require(ChainKeys(secret: secret).open(tsSealed))
    #expect(record.type == "category")
    #expect(record.id == "c1")
    #expect(record.version == 1)
    #expect(
      record.data
        == .object(["name": .string("Tech"), "order": .number(10), "collapsed": .bool(false)]))
  }

  /// The TypeScript tests open this blob (packages/core/tests/chain.test.ts).
  @Test func sealsTheSharedVector() throws {
    let sealed = try ChainKeys(secret: secret).seal(
      ChainSyncRecord(
        type: "feed", id: "abc123",
        data: .object([
          "url": .string("https://blog.example/feed.xml"), "categoryId": .string("uncategorized"),
          "addedAt": .number(1_700_000_000_000),
        ]), hlc: "1700000000001-0000-phone"), iv: Data(repeating: 1, count: 12))
    #expect(sealed.key == vectorSlot)
    #expect(
      sealed.blob
        == "AQEBAQEBAQEBAQEBPaHL4o_tfYn1ebpF8jOaB5YioDRDvrgJN7GHEprFa_tleg_mTSkhmyjYrxnHTScX4TLyC-G-cZzvBWVlzGDel6Ex5JIAStHvCBZuXQVCA-FN7P756Ob3RJCjC-nwWeuwsrkBBADJZqBpxgmKiSs1-Wl_xxXvevQJXkSLttMZ7piijWe-Bonv2s9mSntSLOegDw"
    )
  }

  @Test func sealsAndOpensIncludingTombstones() throws {
    let keys = ChainKeys(secret: ChainCode.newSecret())
    let feed = ChainSyncRecord(
      type: "feed", id: "f1",
      data: .object([
        "url": .string("https://e.com/feed"), "categoryId": .string("uncategorized"),
        "addedAt": .number(1),
      ]), hlc: "1700000000000-0001-a")
    var sealed = try keys.seal(feed)
    #expect(!sealed.key.contains("f1"))
    sealed.version = 3
    var expected = feed
    expected.version = 3
    #expect(keys.open(sealed) == expected)

    var gone = try keys.seal(
      ChainSyncRecord(type: "feed", id: "f1", data: nil, hlc: feed.hlc, deleted: true))
    #expect(gone.deleted && gone.key == sealed.key)
    gone.version = 4
    #expect(keys.open(gone)?.deleted == true)
  }

  @Test func refusesTamperingAndOtherChains() throws {
    let keys = ChainKeys(secret: secret)
    #expect(ChainKeys(secret: ChainCode.newSecret()).open(tsSealed) == nil)
    var moved = tsSealed
    moved.key = vectorSlot
    #expect(keys.open(moved) == nil)
    var redated = tsSealed
    redated.hlc = "1800000000000-0000-dev"
    #expect(keys.open(redated) == nil)
    var flipped = tsSealed
    flipped.deleted = true
    #expect(keys.open(flipped) == nil)
  }

  @Test func marksReadUnstarredStateEphemeral() throws {
    let keys = ChainKeys(secret: ChainCode.newSecret())
    func state(_ read: Bool, _ starred: Bool) throws -> Bool {
      try keys.seal(
        ChainSyncRecord(
          type: "state", id: "f:a",
          data: .object(["read": .bool(read), "starred": .bool(starred)]),
          hlc: "1700000000000-0000-a")
      ).ephemeral
    }
    #expect(try state(true, false))
    #expect(try !state(true, true))
    #expect(try !state(false, false))
  }

  @Test func clockMatchesTheTypeScriptFormat() {
    #expect(
      HybridClock.format(ms: 1_700_000_000_000, counter: 35, node: "ab") == "1700000000000-000z-ab")
    var clock = HybridClock(node: "phone")
    let a = clock.now()
    let b = clock.now()
    #expect(a < b)
    clock.receive("9999999999999-0000-other")
    #expect(clock.now() > "9999999999999-0000-other")
  }
}

// MARK: - The engine, through an in-memory relay

/// A chain relay following the protocol: per slot, the write with the latest
/// clock wins; versions increase per chain.
final class RelayProtocol: URLProtocol, @unchecked Sendable {
  struct Chain {
    var records: [String: ChainRecord] = [:]
    var version = 0
  }
  nonisolated(unsafe) static var chains: [String: Chain] = [:]
  private static let lock = NSLock()

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.lock.lock()
    let (status, body) = handle()
    Self.lock.unlock()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  private func json(_ value: Any) -> Data { try! JSONSerialization.data(withJSONObject: value) }

  private func handle() -> (Int, Data) {
    let url = request.url!
    if url.path() == "/api/v1/server" {
      return (
        200,
        json([
          "software": "perch-server", "version": "0", "mode": "personal", "signup": "closed",
          "community": false, "chain": true, "needsSetup": false,
        ])
      )
    }
    let token = String((request.value(forHTTPHeaderField: "Authorization") ?? "").dropFirst(7))
    let path = url.path().replacingOccurrences(of: "/api/v1/chain", with: "")
    let method = request.httpMethod ?? "GET"
    if path.isEmpty && method == "POST" {
      let created = Self.chains[token] == nil
      if created { Self.chains[token] = Chain() }
      return (
        created ? 201 : 200, json(["created": created, "cursor": Self.chains[token]!.version])
      )
    }
    guard var chain = Self.chains[token] else {
      return (404, json(["error": "chain-not-found", "message": "No chain with this code"]))
    }
    if method == "DELETE" && path.isEmpty {
      Self.chains[token] = nil
      return (204, Data())
    }
    defer { Self.chains[token] = chain }
    switch (method, path) {
    case ("GET", "/changes"):
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let since = Int(items.first { $0.name == "since" }?.value ?? "0") ?? 0
      let limit = Int(items.first { $0.name == "limit" }?.value ?? "500") ?? 500
      let all = chain.records.values.filter { $0.version > since }.sorted {
        $0.version < $1.version
      }
      let page = Array(all.prefix(limit))
      return (
        200,
        json([
          "records": page.map { r -> [String: Any] in
            var o: [String: Any] = [
              "key": r.key, "hlc": r.hlc, "blob": r.blob, "version": r.version,
            ]
            if r.deleted { o["deleted"] = true }
            return o
          },
          "cursor": page.last?.version ?? since,
          "more": all.count > limit,
        ])
      )
    case ("POST", "/push"):
      struct Body: Decodable { var records: [ChainRecord] }
      let body = try! JSONDecoder().decode(Body.self, from: Self.body(of: request))
      var results: [[String: Any]] = []
      for var r in body.records {
        if let existing = chain.records[r.key], r.hlc <= existing.hlc {
          results.append(["key": r.key, "status": "stale", "version": existing.version])
          continue
        }
        chain.version += 1
        r.version = chain.version
        chain.records[r.key] = r
        results.append(["key": r.key, "status": "ok", "version": r.version])
      }
      return (200, json(["results": results, "cursor": chain.version]))
    default:
      return (404, json(["error": "not-found"]))
    }
  }

  /// URLSession hands bodies to protocols as a stream.
  static func body(of request: URLRequest) -> Data {
    if let data = request.httpBody { return data }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while stream.hasBytesAvailable {
      let n = stream.read(&buffer, maxLength: buffer.count)
      if n <= 0 { break }
      data.append(buffer, count: n)
    }
    return data
  }
}

@Suite(.serialized) struct ChainSyncTests {
  let relayURL = URL(string: "https://relay.test")!

  private func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [RelayProtocol.self]
    return URLSession(configuration: config)
  }

  private struct Device {
    let backend: LocalBackend
    let keys: ChainKeys
    let client: ChainClient
    let node: String
    func sync() async throws -> ChainSyncResult {
      try await backend.syncChain(keys: keys, client: client, node: node)
    }
  }

  private func device(_ node: String, code: String) async throws -> Device {
    let dir = FileManager.default.temporaryDirectory.appending(path: "perch-chain-\(UUID())")
    let store = try OfflineStore(url: dir.appending(path: "library.sqlite"))
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    let backend = LocalBackend(store: store, configuration: config)
    await backend.setChain(enabled: true, reset: true)
    let keys = try #require(ChainKeys(code: code))
    return Device(
      backend: backend, keys: keys,
      client: ChainClient(server: relayURL, keys: keys, session: session()),
      node: node)
  }

  private func article(_ feedId: String, _ guid: String) -> Article {
    Article(
      articleId: guid, feedId: feedId, url: "https://blog.example/\(guid)", title: "Item \(guid)",
      author: nil, publishedAt: Date.now.timeIntervalSince1970 * 1000, summaryHtml: nil,
      contentHtml: nil, enclosures: [])
  }

  @Test func twoPhonesShareALibrary() async throws {
    RelayProtocol.chains = [:]
    let code = ChainCode.format(ChainCode.newSecret())
    let phone = try await device("phone", code: code)
    try await phone.client.create()

    // The phone has a feed in a category, a theme and a read article.
    let feedURL = "https://blog.example/feed.xml"
    let feedId = FeedIDs.feed(feedURL)
    let tech = try await phone.backend.addCategory(name: "Tech")
    try await phone.backend.importOPML(
      Data(
        """
        <opml version="2.0"><body><outline text="Blog" xmlUrl="\(feedURL)"/></body></opml>
        """.utf8))
    try await phone.backend.updateFeed(feedId, .init(categoryId: tech.id))
    _ = try await phone.backend.saveSettings(SyncedSettings(theme: .dark))
    await phone.backend.store.insertNew([article(feedId, "a"), article(feedId, "b")])
    try await phone.backend.setState(
      [ArticleRef(feedId: feedId, id: "a")], read: true, starred: nil)
    let first = try await phone.sync()
    #expect(first.pushed == 4)  // feed, category, theme, read state
    #expect(try await phone.sync().pushed == 0)  // nothing changed since

    // The relay holds no URLs or names.
    let stored = RelayProtocol.chains.values.flatMap { $0.records.values }
    let dump = stored.map { "\($0.key) \($0.blob)" }.joined()
    #expect(!dump.contains("blog.example") && !dump.contains(feedId) && !dump.contains("Tech"))

    // An iPad joins: it gets the library and settings, and the read state
    // waits until it has fetched the articles.
    let ipad = try await device("ipad", code: code)
    let res = try await ipad.sync()
    #expect(res.newFeedIds == [feedId])
    #expect(res.pulled == 4)
    let library = try await ipad.backend.library()
    #expect(library.feeds.map(\.url) == [feedURL])
    #expect(library.feeds.first?.categoryId == tech.id)
    #expect(library.categories.map(\.name).contains("Tech"))
    #expect(try await ipad.backend.settings().theme == .dark)
    await ipad.backend.store.insertNew([article(feedId, "a"), article(feedId, "b")])
    await ipad.backend.applyParkedStates()
    #expect(await ipad.backend.store.article("\(feedId):a")?.read == true)
    #expect(await ipad.backend.store.article("\(feedId):b")?.read == false)

    // Starred on the iPad and a rename there reach the phone.
    try await ipad.backend.setState([ArticleRef(feedId: feedId, id: "b")], read: nil, starred: true)
    try await ipad.backend.updateFeed(feedId, .init(customTitle: "My blog"))
    _ = try await ipad.sync()
    _ = try await phone.sync()
    #expect(await phone.backend.store.article("\(feedId):b")?.starred == true)
    #expect(try await phone.backend.library().feeds.first?.customTitle == "My blog")

    // Mark all read on the phone; remove the feed on the iPad.
    try await phone.backend.markAllRead(feed: nil, category: nil, upTo: .now)
    _ = try await phone.sync()
    _ = try await ipad.sync()
    #expect(await ipad.backend.store.article("\(feedId):b")?.read == true)
    try await ipad.backend.removeFeed(feedId)
    _ = try await ipad.sync()
    _ = try await phone.sync()
    #expect(try await phone.backend.library().feeds.isEmpty)
    #expect(await phone.backend.store.pending().isEmpty)
  }

  @Test func localEditsSurviveAnOlderPull() async throws {
    RelayProtocol.chains = [:]
    let code = ChainCode.format(ChainCode.newSecret())
    let a = try await device("a", code: code)
    try await a.client.create()
    let cat = try await a.backend.addCategory(name: "News")
    _ = try await a.sync()
    let b = try await device("b", code: code)
    _ = try await b.sync()

    try await a.backend.updateCategory(cat.id, .init(name: "From A"))
    _ = try await a.sync()
    try await Task.sleep(for: .milliseconds(5))
    // B renames without having pulled A's change: B's later write wins.
    try await b.backend.updateCategory(cat.id, .init(name: "From B"))
    _ = try await b.sync()
    _ = try await a.sync()
    #expect(try await a.backend.library().categories.first { $0.id == cat.id }?.name == "From B")
    #expect(try await b.backend.library().categories.first { $0.id == cat.id }?.name == "From B")
  }

  @Test func aDeletedChainStopsSyncing() async throws {
    RelayProtocol.chains = [:]
    let code = ChainCode.format(ChainCode.newSecret())
    let a = try await device("a", code: code)
    try await a.client.create()
    _ = try await a.sync()
    try await a.client.delete()
    await #expect(throws: ChainError.notFound) { try await a.sync() }
    #expect(await a.backend.chainState().lastError != nil)
    #expect(try await ChainClient.isRelay(relayURL, session: session()))
  }
}
