import Foundation

/// What the Home Screen and Lock Screen widgets show: the unread count and the
/// newest unread articles. The app writes it to the shared app-group folder
/// after each refresh; the widgets only read it, so they never talk to the
/// server and hold no credentials. Compiled into both the app and the widget
/// extension.
struct WidgetSnapshot: Codable, Equatable {
  struct Item: Codable, Equatable, Identifiable {
    var feedId: String
    var articleId: String
    var title: String
    var feedTitle: String
    var published: Date

    var id: String { "\(feedId):\(articleId)" }
    var link: URL { WidgetSnapshot.articleLink(feedId: feedId, articleId: articleId) }
  }

  var unread: Int
  var items: [Item]
  /// The account's accent colours, "#rrggbb".
  var accentLight: String
  var accentDark: String
  var updated: Date

  static let appGroup = "group.app.perch.ios"
  static let widgetKind = "app.perch.ios.unread"

  private static var fileURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appending(path: "widget.json")
  }

  /// Nil when signed out or the app hasn't written one yet.
  static func load() -> WidgetSnapshot? {
    guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    return try? decoder.decode(WidgetSnapshot.self, from: data)
  }

  func save() {
    guard let url = Self.fileURL else { return }
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    guard let data = try? encoder.encode(self) else { return }
    try? data.write(
      to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  static func remove() {
    guard let url = fileURL else { return }
    try? FileManager.default.removeItem(at: url)
  }

  // MARK: Links into the app

  static let unreadLink = URL(string: "perch://unread")!

  static func articleLink(feedId: String, articleId: String) -> URL {
    var parts = URLComponents()
    parts.scheme = "perch"
    parts.host = "article"
    parts.queryItems = [
      URLQueryItem(name: "feed", value: feedId), URLQueryItem(name: "id", value: articleId),
    ]
    return parts.url ?? unreadLink
  }

  /// The article a `perch://article` link points at.
  static func article(in link: URL) -> (feedId: String, articleId: String)? {
    guard link.scheme == "perch", link.host == "article",
      let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems,
      let feed = items.first(where: { $0.name == "feed" })?.value,
      let id = items.first(where: { $0.name == "id" })?.value
    else { return nil }
    return (feed, id)
  }
}
