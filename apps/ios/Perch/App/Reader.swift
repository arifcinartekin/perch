import Foundation
import Observation
import PerchKit

/// What a list of articles shows.
enum Scope: Hashable {
  case all
  case starred
  case category(PerchKit.Category)
  case feed(Feed)

  var title: String {
    switch self {
    case .all: String(localized: "All Feeds")
    case .starred: String(localized: "Starred")
    case .category(let c): c.displayName
    case .feed(let f): f.displayTitle
    }
  }
}

extension PerchKit.Category {
  /// The name to show; the server's built-in "Uncategorized" in the app's
  /// language.
  var displayName: String {
    id == uncategorizedId ? String(localized: "Uncategorized") : name
  }
}

/// The library: feeds, categories, unread counts and settings, from a Perch
/// Server or kept on this phone. With a server it works from the offline
/// store when the server can't be reached, queues read/star changes until it
/// can, and follows the server's event stream while the app is open. On the
/// phone it fetches the feeds itself, now and then while the app is open.
@MainActor @Observable
final class Reader {
  let backend: any ReaderBackend
  let store: OfflineStore
  /// The sync chain, for the library on this phone.
  let chain: ChainLink?
  let device = DeviceSettings.shared
  private let onUnauthorized: @MainActor () -> Void

  private(set) var library = Library()
  private(set) var counts = Counts() {
    didSet { updateGlance() }
  }
  private var glanceTask: Task<Void, Never>?
  private(set) var settings = SyncedSettings()
  private(set) var loaded = false
  /// The last request couldn't reach the server; showing what's on the phone.
  private(set) var isOffline = false
  private(set) var downloading = false
  /// Fetching feeds on the phone (no server).
  private(set) var refreshing = false
  var error: String?
  /// Bumped by every settings change shown, so a reply to an older save
  /// doesn't overwrite a newer one.
  private var settingsEdits = 0

  /// Bumped when articles change elsewhere (new articles, another device read
  /// some), so open lists know to reload.
  private(set) var articlesVersion = 0

  /// Read/star changes made on this device since lists were loaded, so every
  /// list showing the article agrees without a reload.
  private(set) var stateOverrides: [String: (read: Bool, starred: Bool)] = [:]

  private var lastDownload = Date.distantPast
  private var chainTask: Task<Void, Never>?

  init(
    backend: any ReaderBackend, store: OfflineStore, chain: ChainLink? = nil,
    onUnauthorized: @escaping @MainActor () -> Void
  ) {
    self.backend = backend
    self.store = store
    self.chain = chain
    self.onUnauthorized = onUnauthorized
  }

  /// The Perch Server, when signed in to one.
  var server: APIClient? { backend as? APIClient }
  /// The library is on this phone, without an account.
  var isLocal: Bool { server == nil }

  private var sync: OfflineSync? {
    server.map { OfflineSync(client: $0, store: store) }
  }

  // MARK: Library

  /// Categories in sidebar order, each with its feeds by title.
  var groups: [(category: PerchKit.Category, feeds: [Feed])] {
    let byCategory = Dictionary(grouping: library.feeds, by: \.categoryId)
    var categories = library.categories.sorted { ($0.order, $0.name) < ($1.order, $1.name) }
    if !categories.contains(where: { $0.id == uncategorizedId }) {
      categories.append(
        PerchKit.Category(id: uncategorizedId, name: "Uncategorized", order: 1_000_000))
    }
    return categories.map { category in
      let feeds = (byCategory[category.id] ?? []).sorted {
        $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending
      }
      return (category, feeds)
    }
    .filter { !$0.feeds.isEmpty || $0.category.id != uncategorizedId }
  }

  /// Categories a feed can be moved to, Uncategorized included.
  var categoryChoices: [PerchKit.Category] { groups.map(\.category) }

  func feed(_ id: String) -> Feed? { library.feeds.first { $0.id == id } }

  func feedIds(_ scope: Scope) -> Set<String>? {
    switch scope {
    case .all, .starred: nil
    case .feed(let f): [f.id]
    case .category(let c): Set(library.feeds.filter { $0.categoryId == c.id }.map(\.id))
    }
  }

  func unread(_ scope: Scope) -> Int {
    switch scope {
    case .all: counts.unread.values.reduce(0, +)
    case .starred: counts.starred
    case .feed(let f): counts.unread[f.id] ?? 0
    case .category(let c):
      library.feeds.filter { $0.categoryId == c.id }.reduce(0) { $0 + (counts.unread[$1.id] ?? 0) }
    }
  }

  /// Shows what the phone has at once, then catches up with the server.
  func start() async {
    if !loaded, let snapshot = await store.snapshot() {
      library = snapshot.library
      counts = snapshot.counts
      settings = snapshot.settings
      loaded = true
    }
    await load()
    if isLocal {
      await syncChain()
      await refreshIfStale()
    } else {
      await downloadForOffline()
    }
  }

  func load() async {
    let edits = settingsEdits
    await online {
      try? await sync?.flushPending()
      let backend = self.backend
      async let newLibrary = backend.library()
      async let newCounts = backend.counts()
      async let newSettings = backend.settings()
      let (l, c, s) = try await (newLibrary, newCounts, newSettings)
      library = l
      counts = c
      // A change made while this was loading wins.
      if edits == settingsEdits { settings = s }
      stateOverrides = [:]
      loaded = true
      await store.saveSnapshot(library: self.library, counts: self.counts, settings: self.settings)
    }
  }

  func reloadCounts() async {
    await online {
      counts = try await backend.counts()
      await store.saveCounts(counts)
    }
  }

  /// An article by its ids, for links from widgets and notifications: from
  /// the phone if it's saved, else from the feed's newest pages.
  func article(feedId: String, id: String) async -> Article? {
    if let saved = await store.article("\(feedId):\(id)") { return saved }
    var cursor: String?
    for _ in 0..<3 {
      guard
        let page = try? await backend.articles(.init(feed: feedId), before: cursor, limit: 100)
      else { return nil }
      if let hit = page.items.first(where: { $0.articleId == id }) { return hit }
      guard let next = page.next else { return nil }
      cursor = next
    }
    return nil
  }

  /// The widgets follow the unread count, a moment after it settles.
  private func updateGlance() {
    glanceTask?.cancel()
    glanceTask = Task {
      try? await Task.sleep(for: .seconds(2))
      guard !Task.isCancelled, !isOffline else { return }
      await Glance.update(backend: backend, store: store, counts: counts, notify: false)
    }
  }

  /// Fetches feeds now (everything, or one scope): the server does it, or
  /// without one, the phone. Then reloads.
  func refresh(_ scope: Scope = .all) async {
    let ids = feedIds(scope).map(Array.init)
    if isLocal {
      guard !refreshing else { return }
      refreshing = true
    }
    defer { refreshing = false }
    await online { try await backend.refresh(feeds: ids) }
    await load()
    articlesVersion += 1
    if isLocal {
      chainSoon()
      await prefetchImages()
    } else {
      await downloadForOffline(force: true)
    }
  }

  // MARK: Sync chain

  /// A round with the chain, then whatever it brought: the library and
  /// lists reload, and feeds added on other devices are fetched.
  func syncChain() async {
    guard let chain, chain.isOn, let local = backend as? LocalBackend,
      let result = await chain.sync(local)
    else { return }
    guard result.pulled > 0 || !result.newFeedIds.isEmpty else { return }
    await load()
    articlesVersion += 1
    if !result.newFeedIds.isEmpty {
      refreshing = true
      try? await local.refresh(feeds: result.newFeedIds)
      refreshing = false
      await load()
      articlesVersion += 1
    }
  }

  /// A moment after a change here, so a few taps go out together.
  func chainSoon() {
    guard chain?.isOn == true else { return }
    chainTask?.cancel()
    chainTask = Task {
      try? await Task.sleep(for: .seconds(2))
      guard !Task.isCancelled else { return }
      await syncChain()
    }
  }

  /// On the phone: fetches the feeds when the last fetch is a while ago.
  func refreshIfStale(after interval: TimeInterval = 15 * 60) async {
    let oldest = library.feeds.map { $0.lastFetchedAt ?? 0 }.min() ?? .infinity
    guard Date.now.timeIntervalSince1970 * 1000 - oldest > interval * 1000 else { return }
    await refresh()
  }

  /// Keeps recent articles on the phone, at most every ten minutes unless
  /// forced. (Without a server they're always on the phone.)
  func downloadForOffline(force: Bool = false) async {
    guard let sync, device.offlineEnabled, !isOffline, !downloading,
      force || Date.now.timeIntervalSince(lastDownload) > 600
    else { return }
    downloading = true
    defer { downloading = false }
    do {
      try await sync.download(limit: device.offlineLimit, images: device.offlineImages)
      lastDownload = .now
    } catch {}
  }

  /// Without a server: the newest unread articles' images, so they show
  /// offline too.
  private func prefetchImages() async {
    guard device.offlineImages else { return }
    let articles = await store.articles(.init(unreadOnly: true), limit: 300)
    var urls: [URL] = []
    for article in articles {
      let html = article.contentHtml ?? article.summaryHtml ?? ""
      let base = article.url.flatMap(URL.init(string:))
      urls += ImageCache.imageURLs(in: html, base: base).prefix(12)
    }
    await ImageCache.shared.prefetch(urls)
    await ImageCache.shared.trim()
  }

  // MARK: Library management

  func addFeed(url: String, categoryId: String?) async throws -> Feed {
    let result = try await backend.addFeed(url: url, categoryId: categoryId)
    await load()
    articlesVersion += 1
    chainSoon()
    return result.feed
  }

  func removeFeed(_ feed: Feed) async {
    library.feeds.removeAll { $0.id == feed.id }
    await online { try await backend.removeFeed(feed.id) }
    await load()
    chainSoon()
  }

  func updateFeed(_ feed: Feed, title: String, categoryId: String) async throws {
    let trimmed = title.trimmingCharacters(in: .whitespaces)
    try await backend.updateFeed(
      feed.id,
      .init(
        categoryId: categoryId == feed.categoryId ? nil : categoryId,
        customTitle: trimmed == (feed.customTitle ?? "") ? nil : trimmed))
    await load()
    chainSoon()
  }

  func addCategory(_ name: String) async throws -> PerchKit.Category {
    let category = try await backend.addCategory(name: name)
    await load()
    chainSoon()
    return category
  }

  func renameCategory(_ category: PerchKit.Category, to name: String) async {
    await online { try await backend.updateCategory(category.id, .init(name: name)) }
    await load()
    chainSoon()
  }

  func deleteCategory(_ category: PerchKit.Category) async {
    await online { try await backend.deleteCategory(category.id) }
    await load()
    chainSoon()
  }

  func setCollapsed(_ category: PerchKit.Category, _ collapsed: Bool) {
    if let i = library.categories.firstIndex(where: { $0.id == category.id }) {
      library.categories[i].collapsed = collapsed
    } else {
      var c = category
      c.collapsed = collapsed
      library.categories.append(c)
    }
    Task {
      await online { try await backend.updateCategory(category.id, .init(collapsed: collapsed)) }
      chainSoon()
    }
  }

  func isCollapsed(_ category: PerchKit.Category) -> Bool {
    library.categories.first { $0.id == category.id }?.collapsed ?? false
  }

  // MARK: Settings

  /// Applies a change at once and saves it to the account. Only the keys set
  /// in `patch` are sent. If something newer was shown meanwhile (another
  /// colour picked while this was saving), that stays: the reply and a
  /// failure only apply to the latest change.
  func updateSettings(_ patch: SyncedSettings, previousValue: SyncedSettings? = nil) async {
    let before = previousValue ?? settings
    previewSettings(patch)
    let edit = settingsEdits
    do {
      let saved = try await backend.saveSettings(patch)
      guard edit == settingsEdits else { return }
      settings = saved
      await store.saveSnapshot(library: library, counts: counts, settings: settings)
      chainSoon()
    } catch let e as APIError where e.isUnauthorized {
      onUnauthorized()
    } catch {
      guard edit == settingsEdits, !Task.isCancelled else { return }
      settings = before
      self.error = String(localized: "Couldn't save the setting: \(error.localizedDescription)")
    }
  }

  /// Shows a change without saving it, e.g. while a colour picker is dragged.
  func previewSettings(_ patch: SyncedSettings) {
    settingsEdits += 1
    if let v = patch.theme { settings.theme = v }
    if let v = patch.readingFont { settings.readingFont = v }
    if let v = patch.appearance { settings.appearance = v }
    if let v = patch.glass { settings.glass = v }
  }

  // MARK: Article state

  func setRead(_ article: Article, _ read: Bool) async {
    guard current(article).read != read else { return }
    apply(article, read: read)
    await store.setState(article.id, read: read)
    await send(article.ref, read: read)
  }

  func setStarred(_ article: Article, _ starred: Bool) async {
    apply(article, starred: starred)
    await store.setState(article.id, starred: starred)
    await send(article.ref, starred: starred)
  }

  /// Online, the server marks everything up to `upTo`; offline, the articles
  /// on the phone are marked and queued.
  func markAllRead(_ scope: Scope, upTo: Date) async {
    let (feed, category): (String?, String?) =
      switch scope {
      case .feed(let f): (f.id, nil)
      case .category(let c): (nil, c.id)
      case .all, .starred: (nil, nil)
      }
    let upToMs = upTo.timeIntervalSince1970 * 1000
    do {
      try await backend.markAllRead(feed: feed, category: category, upTo: upTo)
      isOffline = false
    } catch let e as APIError where e.isNetwork {
      isOffline = true
      let ids = feedIds(scope)
      for a in await store.articles(.init(feedIds: ids, unreadOnly: true), limit: 100_000)
      where a.publishedAt <= upToMs {
        await store.enqueue(a.ref, read: true)
      }
    } catch {
      self.error = error.localizedDescription
      return
    }
    await store.markRead(feedIds: feedIds(scope), upTo: upToMs)
    stateOverrides = [:]
    if isOffline {
      for id in feedIds(scope) ?? Set(counts.unread.keys) { counts.unread[id] = 0 }
    } else {
      await reloadCounts()
    }
    articlesVersion += 1
    chainSoon()
  }

  /// The article with any change made on this device since it was loaded.
  func current(_ article: Article) -> Article {
    guard let o = stateOverrides[article.id] else { return article }
    var a = article
    a.read = o.read
    a.starred = o.starred
    return a
  }

  private func apply(_ article: Article, read: Bool? = nil, starred: Bool? = nil) {
    let before = current(article)
    let after = (read: read ?? before.read, starred: starred ?? before.starred)
    stateOverrides[article.id] = after
    if before.read != after.read {
      counts.unread[article.feedId] = max(
        0, (counts.unread[article.feedId] ?? 0) + (after.read ? -1 : 1))
    }
    if before.starred != after.starred { counts.starred += after.starred ? 1 : -1 }
  }

  private func send(_ ref: ArticleRef, read: Bool? = nil, starred: Bool? = nil) async {
    do {
      try await backend.setState([ref], read: read, starred: starred)
      chainSoon()
      if isOffline {
        isOffline = false
        try? await sync?.flushPending()
      }
    } catch let e as APIError where e.isNetwork {
      isOffline = true
      await store.enqueue(ref, read: read, starred: starred)
    } catch let e as APIError where e.isUnauthorized {
      onUnauthorized()
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: Full text

  /// From the phone if fetched before, else from the server or the site
  /// (and kept).
  func fullText(_ article: Article) async throws -> FullText {
    if let cached = await store.fullText(article.id) { return cached }
    let text = try await backend.fullText(article.ref)
    await store.saveFullText(text, for: article.id)
    return text
  }

  // MARK: Live updates

  /// Follows the server's event stream until cancelled, reconnecting with
  /// backoff. Run while the app is in the foreground. Without a server,
  /// fetches the feeds every quarter of an hour instead.
  func listen() async {
    guard let client = server else {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        guard !Task.isCancelled else { return }
        await syncChain()
        await refreshIfStale()
      }
      return
    }
    var delay: Duration = .seconds(1)
    var lastCursor: String?
    while !Task.isCancelled {
      do {
        for try await event in client.events() {
          delay = .seconds(1)
          if isOffline {
            // Back online: send what was queued and catch up.
            await load()
            articlesVersion += 1
          }
          switch event {
          case .cursor(let cursor):
            // The first cursor only says where we are; later ones mean a change.
            if let last = lastCursor, last != cursor {
              await load()
              articlesVersion += 1
            }
            lastCursor = cursor
          case .articles:
            await reloadCounts()
            articlesVersion += 1
            await downloadForOffline()
          }
        }
      } catch let error as APIError where error.isUnauthorized {
        onUnauthorized()
        return
      } catch {}
      try? await Task.sleep(for: delay)
      delay = min(delay * 2, .seconds(60))
    }
  }

  // MARK: -

  /// Runs a server call; a network failure flips to offline instead of an error.
  private func online(_ work: () async throws -> Void) async {
    do {
      try await work()
      isOffline = false
      error = nil
    } catch let e as APIError where e.isUnauthorized {
      onUnauthorized()
    } catch let e as APIError where e.isNetwork {
      isOffline = true
    } catch is CancellationError {
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// One scrolling list of articles: pages from the server, or from the phone
/// when offline; search and the unread filter.
@MainActor @Observable
final class ArticleList {
  let scope: Scope
  private let reader: Reader

  private(set) var items: [Article] = []
  private(set) var loading = false
  private(set) var finished = false
  private(set) var error: String?
  /// These came from the phone, not the server.
  private(set) var fromDevice = false
  private var next: String?
  private var generation = 0

  var unreadOnly: Bool
  var search = ""

  /// Where the list was first loaded; "mark all read" stops here so articles
  /// that arrive while you read aren't marked unseen.
  private(set) var loadedAt = Date.now

  init(scope: Scope, reader: Reader, unreadOnly: Bool = false) {
    self.scope = scope
    self.reader = reader
    self.unreadOnly = unreadOnly
  }

  private var query: APIClient.ArticleQuery {
    var q = APIClient.ArticleQuery(unreadOnly: unreadOnly, search: search)
    switch scope {
    case .all: break
    case .starred: q.starred = true
    case .category(let c): q.category = c.id
    case .feed(let f): q.feed = f.id
    }
    return q
  }

  private var localQuery: OfflineStore.Query {
    OfflineStore.Query(
      feedIds: reader.feedIds(scope), unreadOnly: unreadOnly, starred: scope == .starred,
      search: search)
  }

  func reload() async {
    generation += 1
    let gen = generation
    loading = true
    defer { if gen == generation { loading = false } }
    do {
      let page = try await reader.backend.articles(query)
      guard gen == generation else { return }
      items = page.items.map { reader.current($0) }
      next = page.next
      finished = page.next == nil
      fromDevice = false
      loadedAt = .now
      error = nil
      if !reader.isLocal { await reader.store.store(page.items) }
    } catch let e as APIError where e.isNetwork {
      let local = await reader.store.articles(localQuery)
      guard gen == generation else { return }
      items = local
      next = nil
      finished = local.count < 50
      fromDevice = true
      error = nil
    } catch is CancellationError {
    } catch {
      guard gen == generation else { return }
      self.error = error.localizedDescription
    }
  }

  func loadMore() async {
    guard !loading, !finished else { return }
    let gen = generation
    loading = true
    defer { if gen == generation { loading = false } }
    if fromDevice {
      let more = await reader.store.articles(localQuery, before: items.last?.publishedAt)
      guard gen == generation else { return }
      items += more
      finished = more.count < 50
      return
    }
    guard let next else { return }
    do {
      let page = try await reader.backend.articles(query, before: next)
      guard gen == generation else { return }
      let known = Set(items.map(\.id))
      items += page.items.filter { !known.contains($0.id) }
      self.next = page.next
      finished = page.next == nil
      if !reader.isLocal { await reader.store.store(page.items) }
    } catch {}
  }

  /// The article after this one, loading the next page if needed.
  func article(after article: Article) async -> Article? {
    guard let i = items.firstIndex(where: { $0.id == article.id }) else { return nil }
    if i + 1 >= items.count { await loadMore() }
    return i + 1 < items.count ? items[i + 1] : nil
  }
}
