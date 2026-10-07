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
/// settings, kept current by the server's event stream while the app is open.
@MainActor @Observable
final class Reader {
  let client: APIClient
  private let onUnauthorized: @MainActor () -> Void

  private(set) var library = Library()
  private(set) var counts = Counts()
  private(set) var settings = SyncedSettings()
  private(set) var loaded = false
  var error: String?

  /// Bumped when articles change elsewhere (new articles, another device read
  /// some), so open lists know to reload.
  private(set) var articlesVersion = 0

  /// Article state changes made here, so other lists showing the same article
  /// update without a reload.
  private(set) var stateOverrides: [String: (read: Bool, starred: Bool)] = [:]

  init(client: APIClient, onUnauthorized: @escaping @MainActor () -> Void) {
    self.client = client
    self.onUnauthorized = onUnauthorized
  }

  // MARK: Library

  /// Categories in sidebar order, each with its feeds by title.
  var groups: [(category: PerchKit.Category, feeds: [Feed])] {
    let byCategory = Dictionary(grouping: library.feeds, by: \.categoryId)
    var categories = library.categories.sorted { ($0.order, $0.name) < ($1.order, $1.name) }
    if !categories.contains(where: { $0.id == uncategorizedId }) {
      categories.append(
        PerchKit.Category(id: uncategorizedId, name: "Uncategorized", order: .infinity))
    }
    return categories.map { category in
      let feeds = (byCategory[category.id] ?? []).sorted {
        $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending
      }
      return (category, feeds)
    }
    .filter { !$0.feeds.isEmpty || $0.category.id != uncategorizedId }
  }

  func feed(_ id: String) -> Feed? { library.feeds.first { $0.id == id } }

  func unread(_ scope: Scope) -> Int {
    switch scope {
    case .all: counts.unread.values.reduce(0, +)
    case .starred: counts.starred
    case .feed(let f): counts.unread[f.id] ?? 0
    case .category(let c):
      library.feeds.filter { $0.categoryId == c.id }.reduce(0) { $0 + (counts.unread[$1.id] ?? 0) }
    }
  }

  func load() async {
    await run {
      async let library = client.library()
      async let counts = client.counts()
      async let settings = client.settings()
      (self.library, self.counts, self.settings) = try await (library, counts, settings)
      loaded = true
    }
  }

  func reloadCounts() async {
    await run { counts = try await client.counts() }
  }

  /// Asks the server to fetch feeds now (everything, or one scope), then reloads.
  func refresh(_ scope: Scope = .all) async {
    let ids: [String]? =
      switch scope {
      case .all, .starred: nil
      case .feed(let f): [f.id]
      case .category(let c): library.feeds.filter { $0.categoryId == c.id }.map(\.id)
      }
    await run { try await client.refresh(feeds: ids) }
    await load()
    articlesVersion += 1
  }

  func addFeed(url: String, categoryId: String?) async throws -> Feed {
    let result = try await client.addFeed(url: url, categoryId: categoryId)
    await load()
    return result.feed
  }

  func removeFeed(_ feed: Feed) async {
    await run { try await client.removeFeed(feed.id) }
    await load()
  }

  // MARK: Article state

  func setRead(_ article: Article, _ read: Bool) async {
    guard current(article).read != read else { return }
    apply(article, read: read)
    await run { try await client.setState([article.ref], read: read) }
  }

  func setStarred(_ article: Article, _ starred: Bool) async {
    apply(article, starred: starred)
    await run { try await client.setState([article.ref], starred: starred) }
  }

  func markAllRead(_ scope: Scope, upTo: Date) async {
    let (feed, category): (String?, String?) =
      switch scope {
      case .feed(let f): (f.id, nil)
      case .category(let c): (nil, c.id)
      case .all, .starred: (nil, nil)
      }
    await run { try await client.markAllRead(feed: feed, category: category, upTo: upTo) }
    stateOverrides = [:]
    await reloadCounts()
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
      counts.unread[article.feedId, default: 0] += after.read ? -1 : 1
      counts.unread[article.feedId] = max(0, counts.unread[article.feedId] ?? 0)
    }
    if before.starred != after.starred { counts.starred += after.starred ? 1 : -1 }
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

  private func run(_ work: () async throws -> Void) async {
    do {
      try await work()
      error = nil
    } catch let e as APIError where e.isUnauthorized {
      onUnauthorized()
    } catch is CancellationError {
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// One scrolling list of articles: pages from the server, search and the
/// unread filter.
@MainActor @Observable
final class ArticleList {
  let scope: Scope
  private let reader: Reader

  private(set) var items: [Article] = []
  private(set) var loading = false
  private(set) var finished = false
  private(set) var error: String?
  private var next: String?
  private var generation = 0

  var unreadOnly = false
  var search = ""

  /// Where the list was first loaded; "mark all read" stops here so articles
  /// that arrive while you read aren't marked unseen.
  private(set) var loadedAt = Date.now

  init(scope: Scope, reader: Reader) {
    self.scope = scope
    self.reader = reader
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

  func reload() async {
    generation += 1
    let gen = generation
    loading = true
    defer { if gen == generation { loading = false } }
    do {
      let page = try await reader.client.articles(query)
      guard gen == generation else { return }
      items = page.items
      next = page.next
      finished = page.next == nil
      loadedAt = .now
      error = nil
    } catch is CancellationError {
    } catch {
      guard gen == generation else { return }
      self.error = error.localizedDescription
    }
  }

  func loadMore() async {
    guard !loading, !finished, let next else { return }
    let gen = generation
    loading = true
    defer { if gen == generation { loading = false } }
    do {
      let page = try await reader.client.articles(query, before: next)
      guard gen == generation else { return }
      let known = Set(items.map(\.id))
      items += page.items.filter { !known.contains($0.id) }
      self.next = page.next
      finished = page.next == nil
    } catch {}
  }
}
