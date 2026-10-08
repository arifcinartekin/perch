import Foundation
import PerchKit
import UserNotifications
import WidgetKit

/// The things you see without opening the app: the widgets' snapshot and, if
/// turned on, a notification when new articles arrive. Updated by the Reader
/// while the app is open and by background refresh while it's closed.
@MainActor
enum Glance {
  private static let seenKey = "glance.seen"
  private static let itemCount = 8

  /// Fetches the newest unread articles and the unread count, writes the
  /// widget snapshot, and (in the background, when allowed) notifies about
  /// articles not seen before.
  static func update(client: APIClient, store: OfflineStore, counts: Counts? = nil, notify: Bool)
    async
  {
    guard let page = try? await client.articles(.init(unreadOnly: true), limit: itemCount)
    else { return }
    var total = counts
    if total == nil { total = try? await client.counts() }
    guard let counts = total else { return }
    let saved = await store.snapshot()
    let titles = Dictionary(
      (saved?.library.feeds ?? []).map { ($0.id, $0.displayTitle) }, uniquingKeysWith: { a, _ in a }
    )
    let appearance = saved?.settings.appearance ?? Appearance()

    let snapshot = WidgetSnapshot(
      unread: counts.unread.values.reduce(0, +),
      items: page.items.map {
        WidgetSnapshot.Item(
          feedId: $0.feedId, articleId: $0.articleId, title: $0.displayTitle,
          feedTitle: titles[$0.feedId] ?? "", published: $0.published)
      },
      accentLight: Theme.palette(.light, appearance.light).accent,
      accentDark: Theme.palette(.dark, appearance.dark).accent,
      updated: .now)
    let previous = WidgetSnapshot.load()
    if snapshot.items != previous?.items || snapshot.unread != previous?.unread
      || snapshot.accentLight != previous?.accentLight
      || snapshot.accentDark != previous?.accentDark
    {
      snapshot.save()
      WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.widgetKind)
    }

    // Articles shown in the app or a notification once don't come back.
    let seenList = UserDefaults.standard.stringArray(forKey: seenKey)
    let seen = Set(seenList ?? [])
    let unseen = snapshot.items.filter { !seen.contains($0.id) }
    let fresh = unseen.filter { $0.published > .now.addingTimeInterval(-2 * 24 * 3600) }
    UserDefaults.standard.set(
      Array((unseen.map(\.id) + (seenList ?? [])).prefix(400)), forKey: seenKey)
    // The first time, everything is "new"; that's not news.
    let firstRun = seenList == nil
    if notify, !firstRun, !fresh.isEmpty, DeviceSettings.shared.notifyNewArticles {
      await post(fresh)
    }
  }

  #if DEBUG
    /// Treats every unread article as new, so a notification can be checked.
    static func forgetSeen() {
      UserDefaults.standard.set([String](), forKey: seenKey)
    }
  #endif

  /// Signed out: the widgets go back to asking you to sign in.
  static func clear() {
    WidgetSnapshot.remove()
    UserDefaults.standard.removeObject(forKey: seenKey)
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.widgetKind)
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
  }

  /// Asks for permission the first time notifications are turned on.
  static func requestPermission() async -> Bool {
    (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge]))
      ?? false
  }

  private static func post(_ items: [WidgetSnapshot.Item]) async {
    let content = UNMutableNotificationContent()
    if items.count == 1, let item = items.first {
      content.title = item.feedTitle
      content.body = item.title
      content.userInfo = ["link": item.link.absoluteString]
    } else {
      content.title = String(localized: "\(items.count) new articles")
      content.body = items.prefix(3).map(\.title).joined(separator: "\n")
      content.userInfo = ["link": WidgetSnapshot.unreadLink.absoluteString]
    }
    content.threadIdentifier = "new-articles"
    let request = UNNotificationRequest(
      identifier: items.map(\.id).joined(separator: ","), content: content, trigger: nil)
    try? await UNUserNotificationCenter.current().add(request)
  }
}
