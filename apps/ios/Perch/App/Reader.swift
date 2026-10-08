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
    case .all: "All Feeds"
    case .starred: "Starred"
    case .category(let c): c.name
    case .feed(let f): f.displayTitle
    }
  }
}

/// The signed-in library: feeds, categories, unread counts and the synced
/// settings. Works from the offline store when the server can't be reached,
/// queues read/star changes until it can, and follows the server's event
/// stream while the app is open.
@MainActor @Observable
final class Reader {
  let client: APIClient
  let store: OfflineStore
  let device = DeviceSettings.shared
  private let onUnauthorized: @MainActor () -> Void

  private(set) var library = Library()
  private(set) var counts = Counts()
  private(set) var settings = SyncedSettings()
  private(set) var loaded = false
  /// The last request couldn't reach the server; showing what's on the phone.
  private(set) var isOffline = false
  private(set) var downloading = false
  var error: String?

  /// Bumped when articles change elsewhere (new articles, another device read
  /// some), so open lists know to reload.
  private(set) var articlesVersion = 0

  /// Read/star changes made on this device since lists were loaded, so every
  /// list showing the article agrees without a reload.
  private(set) var stateOverrides: [String: (read: Bool, starred: Bool)] = [:]

  private var lastDownload = Date.distantPast
  private var sync: OfflineSync { OfflineSync(client: client, store: store) }

  init(client: APIClient, store: OfflineStore, onUnauthorized: @escaping @MainActor () -> Void) {
    self.client = client
    self.store = store
    self.onUnauthorized = onUnauthorized
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
    await downloadForOffline()
  }

  func load() async {
    await online {
      try? await sync.flushPending()
      async let library = client.library()
      async let counts = client.counts()
      async let settings = client.settings()
      (self.library, self.counts, self.settings) = try await (library, counts, settings)
      stateOverrides = [:]
      loaded = true
      await store.saveSnapshot(library: self.library, counts: self.counts, settings: self.settings)
    }
  }

  func reloadCounts() async {
    await online {
      counts = try await client.counts()
      await store.saveCounts(counts)
    }
  }

  /// Asks the server to fetch feeds now (everything, or one scope), then reloads.
  func refresh(_ scope: Scope = .all) async {
    let ids = feedIds(scope).map(Array.init)
    await online { try await client.refresh(feeds: ids) }
    await load()
    articlesVersion += 1
    await downloadForOffline(force: true)
  }

  /// Keeps recent articles on the phone, at most every ten minutes unless forced.
  func downloadForOffline(force: Bool = false) async {
    guard device.offlineEnabled, !isOffline, !downloading,
      force || Date.now.timeIntervalSince(lastDownload) > 600
    else { return }
    downloading = true
    defer { downloading = false }
    do {
      try await sync.download(limit: device.offlineLimit, images: device.offlineImages)
      lastDownload = .now
    } catch {}
  }

  // MARK: Library management

  func addFeed(url: String, categoryId: String?) async throws -> Feed {
    let result = try await client.addFeed(url: url, categoryId: categoryId)
    await load()
    articlesVersion += 1
    return result.feed
  }

  func removeFeed(_ feed: Feed) async {
    library.feeds.removeAll { $0.id == feed.id }
    await online { try await client.removeFeed(feed.id) }
    await load()
  }

  func updateFeed(_ feed: Feed, title: String, categoryId: String) async throws {
    let trimmed = title.trimmingCharacters(in: .whitespaces)
    try await client.updateFeed(
      feed.id,
      .init(
        categoryId: categoryId == feed.categoryId ? nil : categoryId,
        customTitle: trimmed == (feed.customTitle ?? "") ? nil : trimmed))
    await load()
  }

  func addCategory(_ name: String) async throws -> PerchKit.Category {
    let category = try await client.addCategory(name: name)
    await load()
    return category
  }

  func renameCategory(_ category: PerchKit.Category, to name: String) async {
    await online { try await client.updateCategory(category.id, .init(name: name)) }
    await load()
  }

  func deleteCategory(_ category: PerchKit.Category) async {
    await online { try await client.deleteCategory(category.id) }
    await load()
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
      await online { try await client.updateCategory(category.id, .init(collapsed: collapsed)) }
    }
  }

  func isCollapsed(_ category: PerchKit.Category) -> Bool {
    library.categories.first { $0.id == category.id }?.collapsed ?? false
  }

  // MARK: Settings

  /// Applies a change at once and saves it to the account. Only the keys set
  /// in `patch` are sent.
  func updateSettings(_ patch: SyncedSettings, previousValue: SyncedSettings? = nil) async {
    let before = previousValue ?? settings
    previewSettings(patch)
    do {
      settings = try await client.saveSettings(patch)
      await store.saveSnapshot(library: library, counts: counts, settings: settings)
    } catch let e as APIError where e.isUnauthorized {
      onUnauthorized()
    } catch {
      settings = before
      self.error = "Couldn't save the setting: \(error.localizedDescription)"
    }
  }

  /// Shows a change without saving it, e.g. while a colour picker is dragged.
  func previewSettings(_ patch: SyncedSettings) {
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
      try await client.markAllRead(feed: feed, category: category, upTo: upTo)
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
      try await client.setState([ref], read: read, starred: starred)
      if isOffline {
        isOffline = false
        try? await sync.flushPending()
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

  /// From the phone if fetched before, else from the server (and kept).
  func fullText(_ article: Article) async throws -> FullText {
    if let cached = await store.fullText(article.id) { return cached }
    let text = try await client.fullText(article.ref)
    await store.saveFullText(text, for: article.id)
    return text
  }

  // MARK: Live updates

  /// Follows the server's event stream until cancelled, reconnecting with
  /// backoff. Run while the app is in the foreground.
  func listen() async {
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
      let page = try await reader.client.articles(query)
      guard gen == generation else { return }
      items = page.items.map { reader.current($0) }
      next = page.next
      finished = page.next == nil
      fromDevice = false
      loadedAt = .now
      error = nil
      await reader.store.store(page.items)
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
      let page = try await reader.client.articles(query, before: next)
      guard gen == generation else { return }
      let known = Set(items.map(\.id))
      items += page.items.filter { !known.contains($0.id) }
      self.next = page.next
      finished = page.next == nil
      await reader.store.store(page.items)
    } catch {}
  }

  /// The article after this one, loading the next page if needed.
  func article(after article: Article) async -> Article? {
    guard let i = items.firstIndex(where: { $0.id == article.id }) else { return nil }
    if i + 1 >= items.count { await loadMore() }
    return i + 1 < items.count ? items[i + 1] : nil
  }
}
