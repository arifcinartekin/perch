import Foundation

/// Where the library lives: a Perch Server (`APIClient`) or this device
/// (`LocalBackend`). The app's Reader talks to either the same way.
public protocol ReaderBackend: Sendable {
  func library() async throws -> Library
  func counts() async throws -> Counts
  func settings() async throws -> SyncedSettings
  /// Keys that are set replace the stored ones; returns the result.
  func saveSettings(_ patch: SyncedSettings) async throws -> SyncedSettings

  /// Newest first; `before` is the previous page's `next`.
  func articles(_ q: APIClient.ArticleQuery, before: String?, limit: Int) async throws
    -> ArticlePage
  func fullText(_ ref: ArticleRef, force: Bool) async throws -> FullText
  func setState(_ refs: [ArticleRef], read: Bool?, starred: Bool?) async throws
  func markAllRead(feed: String?, category: String?, upTo: Date) async throws

  /// Fetches feeds now: some, or (nil) all of them.
  func refresh(feeds: [String]?) async throws
  func addFeed(url: String, categoryId: String?) async throws -> APIClient.AddFeedResult
  func removeFeed(_ id: String) async throws
  func updateFeed(_ id: String, _ patch: APIClient.FeedPatch) async throws
  func addCategory(name: String) async throws -> Category
  func updateCategory(_ id: String, _ patch: APIClient.CategoryPatch) async throws
  /// Its feeds move to Uncategorized.
  func deleteCategory(_ id: String) async throws

  /// Newest first.
  func notes() async throws -> [Note]
  /// Creates or updates the note on an article.
  func saveNote(_ source: NoteSource, body: String) async throws -> Note
  func deleteNote(_ id: String) async throws

  func exportOPML() async throws -> Data
  func importOPML(_ data: Data) async throws -> OpmlImportResult
}

extension ReaderBackend {
  public func articles(_ q: APIClient.ArticleQuery, before: String? = nil) async throws
    -> ArticlePage
  {
    try await articles(q, before: before, limit: 50)
  }

  public func fullText(_ ref: ArticleRef) async throws -> FullText {
    try await fullText(ref, force: false)
  }
}

extension APIClient: ReaderBackend {}

extension Article {
  public init(
    articleId: String, feedId: String, url: String?, title: String, author: String?,
    publishedAt: Double, summaryHtml: String?, contentHtml: String?, enclosures: [Enclosure],
    read: Bool = false, starred: Bool = false
  ) {
    self.articleId = articleId
    self.feedId = feedId
    self.url = url
    self.title = title
    self.author = author
    self.publishedAt = publishedAt
    self.summaryHtml = summaryHtml
    self.contentHtml = contentHtml
    self.enclosures = enclosures
    self.read = read
    self.starred = starred
  }
}
