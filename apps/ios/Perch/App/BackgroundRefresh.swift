import BackgroundTasks
import Foundation
import PerchKit
import UIKit

/// Keeps things fresh while the app is closed: iOS wakes it now and then
/// (about every half hour at best) to send queued changes, download new
/// articles for offline reading, update the widgets and notify about new
/// articles.
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
    let work = Task { await run() }
    task.expirationHandler = { work.cancel() }
    Task {
      _ = await work.result
      task.setTaskCompleted(success: !work.isCancelled)
    }
  }

  /// One refresh: send queued changes, download for offline reading, update
  /// the widgets, notify.
  @MainActor static func run() async {
    let device = DeviceSettings.shared
    guard let account = Session.savedAccount() else { return }
    let sync = OfflineSync(client: account.client, store: account.store)
    try? await sync.flushPending()
    if device.offlineEnabled {
      try? await sync.download(limit: device.offlineLimit, images: device.offlineImages)
    }
    await Glance.update(client: account.client, store: account.store, notify: true)
  }

  #if DEBUG
    /// Debug builds only, for checking notifications on the simulator, where
    /// iOS doesn't schedule refreshes on its own: with PERCH_DEV_BACKGROUND
    /// set, going to the background runs one refresh right away; with
    /// PERCH_DEV_BACKGROUND=new every unread article counts as new.
    @MainActor static func runOnBackgroundForTesting() {
      guard let mode = ProcessInfo.processInfo.environment["PERCH_DEV_BACKGROUND"] else { return }
      if mode == "new" { Glance.forgetSeen() }
      let app = UIApplication.shared
      let id = app.beginBackgroundTask(expirationHandler: nil)
      Task {
        await run()
        app.endBackgroundTask(id)
      }
    }
  #endif

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
    try? BGTaskScheduler.shared.submit(request)
  }
}

private struct TaskBox: @unchecked Sendable {
  let task: BGTask
}
