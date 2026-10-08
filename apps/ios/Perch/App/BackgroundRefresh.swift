import BackgroundTasks
import Foundation
import PerchKit

/// Keeps the offline copy fresh while the app is closed: iOS wakes it now and
/// then (about every half hour at best) to send queued changes and download
/// new articles.
enum BackgroundRefresh {
  static let identifier = "app.perch.ios.refresh"

  static func register() {
    // Delivered on the main queue (`using: .main`), so it's safe to hand the
    // task to main-actor code.
    BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
      let box = TaskBox(task: task)
      MainActor.assumeIsolated {
        guard let task = box.task as? BGAppRefreshTask else { return }
        handle(task)
      }
    }
  }

  @MainActor private static func handle(_ task: BGAppRefreshTask) {
    schedule()
    let device = DeviceSettings.shared
    let (enabled, limit, images) = (
      device.offlineEnabled, device.offlineLimit, device.offlineImages
    )
    let work = Task {
      guard let account = Session.savedAccount() else { return }
      let sync = OfflineSync(client: account.client, store: account.store)
      try? await sync.flushPending()
      if enabled { try? await sync.download(limit: limit, images: images) }
    }
    task.expirationHandler = { work.cancel() }
    Task {
      _ = await work.result
      task.setTaskCompleted(success: !work.isCancelled)
    }
  }

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }
}

private struct TaskBox: @unchecked Sendable {
  let task: BGTask
}
