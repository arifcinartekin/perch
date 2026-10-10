import Foundation

// The Perch Server API's types, mirroring packages/core/src/api.ts and
// types.ts. Times are epoch milliseconds on the wire.

public enum ServerMode: String, Codable, Sendable { case personal, e2e }
public enum SignupPolicy: String, Codable, Sendable {
  case open, invite, email, closed

  /// A policy this version doesn't know is read as closed rather than failing
  /// to decode the whole server info.
  public init(from decoder: Decoder) throws {
    self = SignupPolicy(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .closed
  }
}

/// What an emailed code is for.
public enum EmailPurpose: String, Codable, Sendable { case signup, reset, change }

/// `GET /server`, read first when connecting.
public struct ServerInfo: Codable, Sendable, Equatable {
  public var software: String
  public var version: String
  public var mode: ServerMode
  public var signup: SignupPolicy
  public var community: Bool
  /// Relays sync chains; absent on older servers.
  public var chain: Bool?
  /// No accounts yet: the first one to register becomes the admin.
  public var needsSetup: Bool
  /// The server can email codes (signup, password reset); absent on older servers.
  public var email: Bool?
  /// The operator's own privacy policy and terms, when they've published them.
  public var legal: Legal?

  public struct Legal: Codable, Sendable, Equatable {
    public var privacy: String?
    public var terms: String?
  }
}

public struct KdfParams: Codable, Sendable, Equatable {
  public var algorithm: String
  /// Memory in KiB.
  public var memory: Int
  public var iterations: Int
  public var parallelism: Int

  public init(algorithm: String = "argon2id", memory: Int, iterations: Int, parallelism: Int) {
    self.algorithm = algorithm
    self.memory = memory
    self.iterations = iterations
    self.parallelism = parallelism
  }

  /// Same as DEFAULT_KDF in packages/core/src/auth.ts.
  public static let `default` = KdfParams(memory: 64 * 1024, iterations: 3, parallelism: 1)

  /// The bounds a server accepts (KDF_LIMITS); anything else is refused before running.
  public var isValid: Bool {
    algorithm == "argon2id" && (8 * 1024...1024 * 1024).contains(memory)
      && (1...10).contains(iterations) && (1...4).contains(parallelism)
  }
}

public struct PublicUser: Codable, Sendable, Equatable {
  public var id: String
  public var username: String
  public var displayName: String
  public var role: String
  public var createdAt: Double
  /// Only ever sent to the account itself.
  public var email: String?
}

public struct AuthResponse: Codable, Sendable {
  public var token: String
  public var user: PublicUser
}

public struct Feed: Codable, Sendable, Identifiable, Hashable {
  public var id: String
  public var url: String
  public var title: String
  public var customTitle: String?
  public var siteUrl: String?
  public var iconUrl: String?
  public var categoryId: String
  public var addedAt: Double
  public var lastFetchedAt: Double?
  public var lastError: String?

  /// The custom title when set, else the feed's own.
  public var displayTitle: String {
    if let custom = customTitle, !custom.isEmpty { return custom }
    return title.isEmpty ? (URL(string: url)?.host() ?? url) : title
  }
}

public struct Category: Codable, Sendable, Identifiable, Hashable {
  public var id: String
  public var name: String
  public var order: Double
  public var collapsed: Bool?

  public init(id: String, name: String, order: Double, collapsed: Bool? = nil) {
    self.id = id
    self.name = name
    self.order = order
    self.collapsed = collapsed
  }
}

/// The category every feed falls back to (UNCATEGORIZED_ID in core).
public let uncategorizedId = "uncategorized"

public struct Enclosure: Codable, Sendable, Hashable {
  public var url: String
  public var type: String?
  public var length: Double?
}

public struct Article: Codable, Sendable, Identifiable, Hashable {
  /// The article's own id; unique only within its feed.
  public var articleId: String
  public var feedId: String
  public var url: String?
  public var title: String
  public var author: String?
  public var publishedAt: Double
  public var summaryHtml: String?
  public var contentHtml: String?
  public var enclosures: [Enclosure]
  public var read: Bool
  public var starred: Bool

  /// Unique across feeds: `feedId:id`, the form sync and the web reader use.
  public var id: String { "\(feedId):\(articleId)" }
  public var ref: ArticleRef { ArticleRef(feedId: feedId, id: articleId) }
  public var published: Date { Date(timeIntervalSince1970: publishedAt / 1000) }
  /// The title as text. Older servers stored some titles with HTML entities.
  public var displayTitle: String {
    title.isEmpty ? "Untitled" : HTMLText.decodeEntities(title)
  }

  enum CodingKeys: String, CodingKey {
    case articleId = "id"
    case feedId, url, title, author, publishedAt, summaryHtml, contentHtml, enclosures, read,
      starred
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    articleId = try c.decode(String.self, forKey: .articleId)
    feedId = try c.decode(String.self, forKey: .feedId)
    url = try c.decodeIfPresent(String.self, forKey: .url)
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    author = try c.decodeIfPresent(String.self, forKey: .author)
    publishedAt = try c.decode(Double.self, forKey: .publishedAt)
    summaryHtml = try c.decodeIfPresent(String.self, forKey: .summaryHtml)
    contentHtml = try c.decodeIfPresent(String.self, forKey: .contentHtml)
    enclosures = try c.decodeIfPresent([Enclosure].self, forKey: .enclosures) ?? []
    // 0 | 1 on the wire.
    read = try c.decode(Int.self, forKey: .read) != 0
    starred = try c.decode(Int.self, forKey: .starred) != 0
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(articleId, forKey: .articleId)
    try c.encode(feedId, forKey: .feedId)
    try c.encodeIfPresent(url, forKey: .url)
    try c.encode(title, forKey: .title)
    try c.encodeIfPresent(author, forKey: .author)
    try c.encode(publishedAt, forKey: .publishedAt)
    try c.encodeIfPresent(summaryHtml, forKey: .summaryHtml)
    try c.encodeIfPresent(contentHtml, forKey: .contentHtml)
    try c.encode(enclosures, forKey: .enclosures)
    try c.encode(read ? 1 : 0, forKey: .read)
    try c.encode(starred ? 1 : 0, forKey: .starred)
  }
}

public struct ArticleRef: Codable, Sendable, Hashable {
  public var feedId: String
  public var id: String
  public init(feedId: String, id: String) {
    self.feedId = feedId
    self.id = id
  }
}

public struct FullText: Codable, Sendable, Hashable {
  /// Sanitised by the server.
  public var html: String
  public var title: String?
  public var byline: String?
}

public struct Library: Codable, Sendable {
  public var feeds: [Feed]
  public var categories: [Category]
  public init(feeds: [Feed] = [], categories: [Category] = []) {
    self.feeds = feeds
    self.categories = categories
  }
}

public struct Counts: Codable, Sendable {
  public var unread: [String: Int]
  public var starred: Int
  public init(unread: [String: Int] = [:], starred: Int = 0) {
    self.unread = unread
    self.starred = starred
  }
}

public struct ArticlePage: Codable, Sendable {
  public var items: [Article]
  /// Pass as `before` for the next page; nil at the end.
  public var next: String?
}

/// The settings that follow the account (SyncedSettings in core). Unknown keys
/// are ignored; saving sends only the keys that changed.
public struct SyncedSettings: Codable, Sendable, Equatable {
  public enum Theme: String, Codable, Sendable, CaseIterable { case system, light, dark }
  public enum ReadingFont: String, Codable, Sendable, CaseIterable { case sans, serif }

  public var theme: Theme?
  public var readingFont: ReadingFont?
  public var appearance: Appearance?
  public var glass: GlassSettings?

  public init(
    theme: Theme? = nil, readingFont: ReadingFont? = nil, appearance: Appearance? = nil,
    glass: GlassSettings? = nil
  ) {
    self.theme = theme
    self.readingFont = readingFont
    self.appearance = appearance
    self.glass = glass
  }

  public init(from decoder: Decoder) throws {
    // Lenient: a value from a newer client shouldn't break the whole object.
    let c = try decoder.container(keyedBy: CodingKeys.self)
    theme = try? c.decodeIfPresent(Theme.self, forKey: .theme)
    readingFont = try? c.decodeIfPresent(ReadingFont.self, forKey: .readingFont)
    appearance = try? c.decodeIfPresent(Appearance.self, forKey: .appearance)
    glass = try? c.decodeIfPresent(GlassSettings.self, forKey: .glass)
  }
}

public struct Device: Codable, Sendable, Identifiable, Hashable {
  public var id: String
  public var name: String
  public var createdAt: Double
  public var lastSeenAt: Double
  public var current: Bool
}

public struct Invite: Codable, Sendable, Identifiable, Hashable {
  public var code: String
  public var createdAt: Double
  public var usedBy: String?
  public var usedAt: Double?
  public var id: String { code }
}

public struct OpmlImportResult: Codable, Sendable {
  public var added: Int
  public var existing: Int
  public var categories: Int
}

/// A note on an article (packages/core/src/notes.ts). id = "feedId:articleId".
public struct Note: Codable, Sendable, Identifiable, Hashable {
  public var feedId: String
  public var articleId: String
  /// The article, so the note keeps its context after the article ages out.
  public var title: String
  public var url: String?
  public var feedTitle: String?
  public var body: String
  public var createdAt: Double
  public var updatedAt: Double
  /// The public page, while the note is shared.
  public var sharedUrl: String?

  public var id: String { "\(feedId):\(articleId)" }
  public var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }

  /// Longest body, in characters (NOTE_MAX).
  public static let maxLength = 10_000

  enum CodingKeys: String, CodingKey {
    case feedId, articleId, title, url, feedTitle, body, createdAt, updatedAt, sharedUrl
  }

  public init(
    feedId: String, articleId: String, title: String, url: String?, feedTitle: String?,
    body: String, createdAt: Double, updatedAt: Double, sharedUrl: String? = nil
  ) {
    self.feedId = feedId
    self.articleId = articleId
    self.title = title
    self.url = url
    self.feedTitle = feedTitle
    self.body = body
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.sharedUrl = sharedUrl
  }
}

/// The article a note is about.
public struct NoteSource: Sendable, Hashable {
  public var feedId: String
  public var articleId: String
  public var title: String
  public var url: String?
  public var feedTitle: String?

  public init(feedId: String, articleId: String, title: String, url: String?, feedTitle: String?) {
    self.feedId = feedId
    self.articleId = articleId
    self.title = title
    self.url = url
    self.feedTitle = feedTitle
  }

  public var id: String { "\(feedId):\(articleId)" }
}
