import Foundation

/// A page shared to Perch from another app (the share extension), waiting in
/// the shared app group for the app to open its Add a feed sheet, as
/// Share → Perch does on Android. Compiled into the app and the extension.
enum SharedInbox {
  private static let key = "share.pending"
  private static var defaults: UserDefaults? { UserDefaults(suiteName: WidgetSnapshot.appGroup) }

  /// Keeps the latest shared address.
  static func put(_ url: URL) {
    defaults?.set(url.absoluteString, forKey: key)
  }

  /// The waiting address, once.
  static func take() -> String? {
    guard let defaults, let value = defaults.string(forKey: key) else { return nil }
    defaults.removeObject(forKey: key)
    return value
  }
}
