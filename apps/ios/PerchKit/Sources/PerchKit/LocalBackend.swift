import Foundation

/// The library kept entirely on this device, for reading without a Perch
/// Server: the phone fetches the feeds itself, like the browser extension
/// does. Feeds, categories and settings are JSON values in the store; the
/// articles are its rows, and this is the only copy of them.
public actor LocalBackend: ReaderBackend {
  public enum Failure: Error, Equatable {
    /// The address gave neither a feed nor a page that names one.
    case noFeed
    case badAddress
    case unreachable(String)
    /// Full text: the page had nothing that looked like an article.
    case noArticleText
  }

  /// Articles older than this are dropped (starred ones stay), and not
  /// added again when a feed still lists them.
  public static let keepDays = 60.0

  public let store: OfflineStore
  private let session: URLSession
  // Internal, not private: the chain engine (LocalBackend+Chain.swift) works
  // on them too.
  var state: Saved?
  /// In a sync chain: read and star changes are queued to go out.
  var chainOn = false
  var chainRun: Task<ChainSyncResult, Error>?

  struct Saved: Codable {
    var library = Library()
    var settings = SyncedSettings()
    /// Per feed: validators for conditional requests.
    var validators: [String: Validators] = [:]
    /// By note id. Optional so libraries saved before notes still load.
    var notes: [String: Note]? = nil
  }

  struct Validators: Codable {
    var etag: String?
    var lastModified: String?

    init(_ response: URLResponse) {
      let http = response as? HTTPURLResponse
      etag = http?.value(forHTTPHeaderField: "ETag")
      lastModified = http?.value(forHTTPHeaderField: "Last-Modified")
    }
  }

  private static let key = "local"

  /// `configuration` is for tests (a stub URLProtocol); requests are always
  /// made without cookies or a cache.
  public init(store: OfflineStore, configuration: URLSessionConfiguration = .ephemeral) {
    self.store = store
    let config = configuration
    // Feeds are fetched without cookies or a shared cache, so sites can't
    // tie the requests together.
    config.httpCookieAcceptPolicy = .never
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.timeoutIntervalForRequest = 20
    config.httpAdditionalHeaders = ["User-Agent": "Perch/1.0 (feed reader; iPhone)"]
    session = URLSession(configuration: config)
  }

  func load() async -> Saved {
    if let state { return state }
    let saved: Saved = await store.load(Self.key) ?? Saved()
    state = saved
    return saved
  }

  func update(_ change: (inout Saved) -> Void) async {
    var s = await load()
    change(&s)
    state = s
    await store.save(s, key: Self.key)
  }

  // MARK: Library

  public func library() async throws -> Library { await load().library }

  public func counts() async throws -> Counts {
    let feeds = Set(await load().library.feeds.map(\.id))
    let unread = await store.unreadCounts().filter { feeds.contains($0.key) }
    return Counts(unread: unread, starred: await store.starredCount())
  }

  public func settings() async throws -> SyncedSettings { await load().settings }

  public func saveSettings(_ patch: SyncedSettings) async throws -> SyncedSettings {
    await update { s in
      if let v = patch.theme { s.settings.theme = v }
      if let v = patch.readingFont { s.settings.readingFont = v }
      if let v = patch.appearance { s.settings.appearance = v }
      if let v = patch.glass { s.settings.glass = v }
    }
    return await load().settings
  }

  // MARK: Notes

  public func notes() async throws -> [Note] {
    (await load().notes ?? [:]).values.sorted { $0.updatedAt > $1.updatedAt }
  }

  public func saveNote(_ source: NoteSource, body: String) async throws -> Note {
    let now = Date.now.timeIntervalSince1970 * 1000
    var saved: Note!
    await update { s in
      let existing = s.notes?[source.id]
      saved = Note(
        feedId: source.feedId, articleId: source.articleId, title: source.title, url: source.url,
        feedTitle: source.feedTitle, body: String(body.prefix(Note.maxLength)),
        createdAt: existing?.createdAt ?? now, updatedAt: now, sharedUrl: existing?.sharedUrl)
      s.notes = (s.notes ?? [:]).merging([source.id: saved]) { _, new in new }
    }
    return saved
  }

  public func deleteNote(_ id: String) async throws {
    await update { s in s.notes?[id] = nil }
  }

  // MARK: Articles

  public func articles(_ q: APIClient.ArticleQuery, before: String?, limit: Int) async throws
    -> ArticlePage
  {
    let library = await load().library
    // Like the server: lists show the feeds you follow; starred articles stay
    // after their feed is removed.
    var feedIds: Set<String>? = q.starred ? nil : Set(library.feeds.map(\.id))
    if let feed = q.feed { feedIds = [feed] }
    if let category = q.category {
      feedIds = Set(library.feeds.filter { $0.categoryId == category }.map(\.id))
    }
    let items = await store.articles(
      OfflineStore.Query(
        feedIds: feedIds, unreadOnly: q.unreadOnly, starred: q.starred, search: q.search ?? ""),
      before: before.flatMap(Double.init), limit: limit)
    let next = items.count == limit ? items.last.map { String($0.publishedAt) } : nil
    return ArticlePage(items: items, next: next)
  }

  public func fullText(_ ref: ArticleRef, force: Bool) async throws -> FullText {
    guard let article = await store.article("\(ref.feedId):\(ref.id)"),
      let url = article.url.flatMap(URL.init(string:)), url.scheme?.hasPrefix("http") == true
    else { throw Failure.noArticleText }
    let (data, _) = try await get(url)
    guard let text = Readability.extract(Self.decode(data)) else { throw Failure.noArticleText }
    return text
  }

  public func setState(_ refs: [ArticleRef], read: Bool?, starred: Bool?) async throws {
    for ref in refs {
      await store.setState("\(ref.feedId):\(ref.id)", read: read, starred: starred)
      if chainOn { await store.enqueue(ref, read: read, starred: starred) }
    }
  }

  public func markAllRead(feed: String?, category: String?, upTo: Date) async throws {
    var ids: Set<String>?
    if let feed { ids = [feed] }
    if let category {
      ids = Set(await load().library.feeds.filter { $0.categoryId == category }.map(\.id))
    }
    let marked = await store.markRead(feedIds: ids, upTo: upTo.timeIntervalSince1970 * 1000)
    if chainOn {
      for ref in marked { await store.enqueue(ref, read: true) }
    }
  }

  // MARK: Fetching

  /// Fetches feeds a few at a time and adds their new articles. A feed that
  /// fails keeps its articles and notes the error.
  public func refresh(feeds ids: [String]?) async throws {
    let s = await load()
    let feeds = s.library.feeds.filter { ids == nil || ids!.contains($0.id) }
    let session = self.session
    let validators = s.validators
    var results: [(Feed, Result<Fetched?, Error>)] = []
    await withTaskGroup(of: (Feed, Result<Fetched?, Error>).self) { group in
      var queue = feeds[...]
      func next() {
        guard let feed = queue.popFirst() else { return }
        group.addTask {
          do {
            let fetched = try await Self.fetch(
              feed: feed, validators: validators[feed.id], session: session)
            return (feed, .success(fetched))
          } catch {
            return (feed, .failure(error))
          }
        }
      }
      for _ in 0..<6 { next() }
      for await result in group {
        results.append(result)
        next()
      }
    }

    let now = Date.now.timeIntervalSince1970 * 1000
    // A feed removed while it was being fetched (here or by the sync chain)
    // must not get its articles back.
    let subscribed = Set(await load().library.feeds.map(\.id))
    var updated: [String: Feed] = [:]
    var newValidators: [String: Validators] = [:]
    for (feed, result) in results where subscribed.contains(feed.id) {
      var f = feed
      f.lastFetchedAt = now
      switch result {
      case .success(nil):
        f.lastError = nil
      case .success(let fetched?):
        f.lastError = nil
        if !fetched.feed.title.isEmpty { f.title = fetched.feed.title }
        if let site = fetched.feed.siteUrl { f.siteUrl = site }
        newValidators[feed.id] = fetched.validators
        await store.insertNew(Self.articles(fetched.feed, feedId: feed.id))
      case .failure(let error):
        f.lastError = Self.describe(error)
      }
      updated[feed.id] = f
    }
    await store.prune(before: now - Self.keepDays * 86_400_000)
    await store.deleteArticles(notIn: Set(await load().library.feeds.map(\.id)), keepStarred: true)
    await update { s in
      for i in s.library.feeds.indices {
        if let f = updated[s.library.feeds[i].id] { s.library.feeds[i] = f }
      }
      s.validators.merge(newValidators) { _, new in new }
    }
    await applyParkedStates()
  }

  private struct Fetched: Sendable {
    var feed: ParsedFeed
    var validators: Validators
  }

  /// nil when the feed hasn't changed since last time (304).
  private static func fetch(feed: Feed, validators: Validators?, session: URLSession)
    async throws -> Fetched?
  {
    guard let url = URL(string: feed.url) else { throw Failure.badAddress }
    var req = URLRequest(url: url)
    req.setValue(accept, forHTTPHeaderField: "Accept")
    if let etag = validators?.etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    if let lm = validators?.lastModified {
      req.setValue(lm, forHTTPHeaderField: "If-Modified-Since")
    }
    let (data, response) = try await session.data(for: req)
    let http = response as? HTTPURLResponse
    if http?.statusCode == 304 { return nil }
    try check(http)
    let parsed = try FeedParser.parse(data, url: response.url ?? url)
    return Fetched(feed: parsed, validators: Validators(response))
  }

  private static func articles(_ feed: ParsedFeed, feedId: String) -> [Article] {
    let now = Date.now.timeIntervalSince1970 * 1000
    let oldest = now - keepDays * 86_400_000
    return feed.items.compactMap { item in
      // Undated items count as new when first seen; their id leaves the
      // date out so they don't come back every time.
      let published = item.published.map { $0.timeIntervalSince1970 * 1000 }
      let at = min(published ?? now, now)
      guard at >= oldest else { return nil }
      let id = FeedIDs.article(feedId: feedId, item, publishedAt: published ?? 0)
      return Article(
        articleId: id, feedId: feedId, url: item.url, title: item.title, author: item.author,
        publishedAt: at, summaryHtml: item.summaryHtml.map(HTMLText.sanitize),
        contentHtml: item.contentHtml.map(HTMLText.sanitize), enclosures: item.enclosures)
    }
  }

  // MARK: Library management

  /// Takes a feed address or a site's address (finding the feed it names,
  /// or one at a usual location).
  public func addFeed(url input: String, categoryId: String?) async throws
    -> APIClient.AddFeedResult
  {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.contains("://") { text = "https://" + text }
    guard var parts = URLComponents(string: text),
      parts.scheme == "http" || parts.scheme == "https",
      parts.host?.isEmpty == false
    else { throw Failure.badAddress }
    if parts.path.isEmpty { parts.path = "/" }
    guard let url = parts.url else { throw Failure.badAddress }

    let (feedURL, parsed, validators) = try await discover(url)
    let id = FeedIDs.feed(feedURL.absoluteString)
    if let existing = await load().library.feeds.first(where: { $0.id == id }) {
      return .init(feed: existing, created: false)
    }
    let category =
      await load().library.categories.contains { $0.id == categoryId }
      ? categoryId! : uncategorizedId
    let feed = Feed(
      id: id, url: feedURL.absoluteString, title: parsed.title, customTitle: nil,
      siteUrl: parsed.siteUrl ?? url.absoluteString, iconUrl: nil, categoryId: category,
      addedAt: Date.now.timeIntervalSince1970 * 1000,
      lastFetchedAt: Date.now.timeIntervalSince1970 * 1000, lastError: nil)
    await store.insertNew(Self.articles(parsed, feedId: id))
    await update { s in
      s.library.feeds.append(feed)
      s.validators[id] = validators
    }
    await applyParkedStates()
    return .init(feed: feed, created: true)
  }

  /// The feed at `url`, or the one the page there names, or one at a usual
  /// location on the same site.
  private func discover(_ url: URL) async throws -> (URL, ParsedFeed, Validators) {
    let (data, response) = try await get(url)
    let final = response.url ?? url
    if let feed = try? FeedParser.parse(data, url: final) {
      return (final, feed, Validators(response))
    }
    let named = FeedDiscovery.links(in: Self.decode(data), pageURL: final)
    for candidate in named + FeedDiscovery.guesses(for: final) {
      guard let (data, response) = try? await get(candidate),
        let feed = try? FeedParser.parse(data, url: response.url ?? candidate)
      else { continue }
      return (response.url ?? candidate, feed, Validators(response))
    }
    throw Failure.noFeed
  }

  public func removeFeed(_ id: String) async throws {
    await update { s in
      s.library.feeds.removeAll { $0.id == id }
      s.validators[id] = nil
    }
    await store.deleteArticles(feedId: id, keepStarred: true)
  }

  public func updateFeed(_ id: String, _ patch: APIClient.FeedPatch) async throws {
    await update { s in
      guard let i = s.library.feeds.firstIndex(where: { $0.id == id }) else { return }
      if let c = patch.categoryId { s.library.feeds[i].categoryId = c }
      if let t = patch.customTitle { s.library.feeds[i].customTitle = t.isEmpty ? nil : t }
    }
  }

  public func addCategory(name: String) async throws -> Category {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if let existing = await load().library.categories.first(where: {
      $0.name.caseInsensitiveCompare(trimmed) == .orderedSame
    }) {
      return existing
    }
    let order =
      (await load().library.categories.map(\.order).filter { $0 < 1000 }.max() ?? 0) + 10
    let category = Category(id: Self.newId(), name: trimmed, order: order)
    await update { $0.library.categories.append(category) }
    return category
  }

  public func updateCategory(_ id: String, _ patch: APIClient.CategoryPatch) async throws {
    await update { s in
      if !s.library.categories.contains(where: { $0.id == id }), id == uncategorizedId {
        s.library.categories.append(Category(id: id, name: "Uncategorized", order: 1_000_000))
      }
      guard let i = s.library.categories.firstIndex(where: { $0.id == id }) else { return }
      if let n = patch.name { s.library.categories[i].name = n }
      if let c = patch.collapsed { s.library.categories[i].collapsed = c }
    }
  }

  public func deleteCategory(_ id: String) async throws {
    guard id != uncategorizedId else { return }
    await update { s in
      s.library.categories.removeAll { $0.id == id }
      for i in s.library.feeds.indices where s.library.feeds[i].categoryId == id {
        s.library.feeds[i].categoryId = uncategorizedId
      }
    }
  }

  // MARK: OPML

  public func exportOPML() async throws -> Data {
    OPML.build(await load().library)
  }

  /// Adds the list's feeds (not fetched yet; `refresh` does that) and the
  /// categories they're in.
  public func importOPML(_ data: Data) async throws -> OpmlImportResult {
    let outlines = try OPML.parse(data)
    var result = OpmlImportResult(added: 0, existing: 0, categories: 0)
    for outline in outlines {
      guard let url = URL(string: outline.url.trimmingCharacters(in: .whitespaces)),
        url.scheme == "http" || url.scheme == "https"
      else { continue }
      let id = FeedIDs.feed(url.absoluteString)
      if await load().library.feeds.contains(where: { $0.id == id }) {
        result.existing += 1
        continue
      }
      var categoryId = uncategorizedId
      if let name = outline.category {
        let before = await load().library.categories.count
        categoryId = try await addCategory(name: name).id
        if await load().library.categories.count > before { result.categories += 1 }
      }
      let feed = Feed(
        id: id, url: url.absoluteString, title: outline.title ?? "", customTitle: nil,
        siteUrl: nil, iconUrl: nil, categoryId: categoryId,
        addedAt: Date.now.timeIntervalSince1970 * 1000, lastFetchedAt: nil, lastError: nil)
      await update { $0.library.feeds.append(feed) }
      result.added += 1
    }
    return result
  }

  // MARK: Plumbing

  private static let accept =
    "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8"

  private func get(_ url: URL) async throws -> (Data, URLResponse) {
    var req = URLRequest(url: url)
    req.setValue(Self.accept, forHTTPHeaderField: "Accept")
    let (data, response) = try await session.data(for: req)
    try Self.check(response as? HTTPURLResponse)
    return (data, response)
  }

  private static func check(_ http: HTTPURLResponse?) throws {
    guard let http, !(200..<300).contains(http.statusCode) else { return }
    throw Failure.unreachable(
      "\(http.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: http.statusCode))")
  }

  private static func describe(_ error: Error) -> String {
    switch error {
    case Failure.unreachable(let why): why
    case FeedParser.Failure.notAFeed: "Not a feed"
    default: error.localizedDescription
    }
  }

  /// Pages are usually UTF-8; Latin-1 keeps any bytes readable otherwise.
  private static func decode(_ data: Data) -> String {
    String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
  }

  private static func newId() -> String {
    let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<8).map { _ in chars.randomElement()! })
  }
}
