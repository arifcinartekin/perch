import Foundation
import Observation
import UserNotifications

/// `perch://` links from the widgets and notifications, waiting for the tabs
/// to open them.
@MainActor @Observable
final class DeepLinks {
  static let shared = DeepLinks()
  var pending: URL?

  func open(_ url: URL) {
    guard url.scheme == "perch" else { return }
    pending = url
  }
}

/// Taps on notifications become deep links.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
  static let shared = NotificationDelegate()

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard let link = response.notification.request.content.userInfo["link"] as? String,
      let url = URL(string: link)
    else { return }
    await MainActor.run { DeepLinks.shared.open(url) }
  }

  /// New-article notifications are for when the app is closed; while it's open
  /// the lists already show them.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    []
  }
}
