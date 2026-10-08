import Foundation
import PerchKit

/// Brings the offline store up to date: sends read/star changes made offline,
/// then downloads recent unread and all starred articles (and their images).
/// Used by the Reader in the foreground and by the background refresh task.
struct OfflineSync: Sendable {
  let client: APIClient
  let store: OfflineStore

  /// Sends queued changes, grouped into as few requests as possible. Throws
  /// when the server can't be reached; what was sent is cleared.
  func flushPending() async throws {
    let pending = await store.pending()
    guard !pending.isEmpty else { return }
    struct Key: Hashable {
      var read: Bool?
      var starred: Bool?
    }
    for (key, group) in Dictionary(
      grouping: pending, by: { Key(read: $0.read, starred: $0.starred) })
    {
      for chunk in stride(from: 0, to: group.count, by: 500) {
        let slice = Array(group[chunk..<min(chunk + 500, group.count)])
        try await client.setState(slice.map(\.ref), read: key.read, starred: key.starred)
        await store.clearPending(slice)
      }
    }
  }

  /// Downloads up to `limit` newest unread articles and every starred one.
  func download(limit: Int, images: Bool) async throws {
    let unread = try await pages(.init(unreadOnly: true), upTo: limit)
    await store.store(unread)
    let starred = try await pages(.init(starred: true), upTo: 1000)
    await store.store(starred)
    await store.trim(keep: limit)

    guard images else { return }
    var urls: [URL] = []
    for article in unread + starred {
      let html = article.contentHtml ?? article.summaryHtml ?? ""
      let base = article.url.flatMap(URL.init(string:))
      urls += ImageCache.imageURLs(in: html, base: base).prefix(12)
    }
    await ImageCache.shared.prefetch(urls)
    await ImageCache.shared.trim()
  }

  private func pages(_ query: APIClient.ArticleQuery, upTo limit: Int) async throws -> [Article] {
    var out: [Article] = []
    var cursor: String?
    repeat {
      let page = try await client.articles(
        query, before: cursor, limit: min(200, limit - out.count))
      out += page.items
      cursor = page.next
    } while cursor != nil && out.count < limit && !Task.isCancelled
    return out
  }
}
