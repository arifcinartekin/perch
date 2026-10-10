import PerchKit
import SwiftUI
import UIKit
import UserNotifications

@main
struct PerchApp: App {
  @State private var session = Session()
  @State private var lock = AppLock()
  @Environment(\.scenePhase) private var scenePhase

  init() {
    BackgroundRefresh.register()
    UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
        .environment(lock)
        .overlay {
          // Locked, or (with the lock on) leaving the app: the app switcher
          // shouldn't show what you were reading.
          if lock.isLocked {
            LockScreen().environment(lock)
          } else if lock.isEnabled && scenePhase != .active {
            PrivacyCover()
          }
        }
        .onOpenURL { DeepLinks.shared.open($0) }
    }
    .onChange(of: scenePhase) { old, phase in
      if phase == .active && old == .background { lock.willEnterForeground() }
      if phase == .background {
        lock.didEnterBackground()
        BackgroundRefresh.schedule()
        #if DEBUG
          BackgroundRefresh.runOnBackgroundForTesting()
        #endif
      }
    }
  }
}

struct RootView: View {
  @Environment(Session.self) private var session
  @Environment(\.colorScheme) private var colorScheme

  /// While restoring there are no settings yet: the default palette for the
  /// system's light or dark mode.
  private var defaultTheme: AppTheme {
    var theme = AppTheme.default
    theme.palette = Theme.palette(colorScheme == .dark ? .dark : .light)
    return theme
  }

  var body: some View {
    if session.phase != .restoring, let backend = session.backend, let store = session.store {
      LibraryRoot(backend: backend, store: store, session: session)
        // Another account, or the phone's own library, starts from scratch.
        .id(ObjectIdentifier(store))
    } else {
      Backdrop()
        .environment(\.theme, defaultTheme)
    }
  }
}

/// Holds the Reader for one library, applies its look, and keeps things live
/// while the app is active.
private struct LibraryRoot: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var reader: Reader
  @State private var system = SystemAppearance()

  init(backend: any ReaderBackend, store: OfflineStore, session: Session) {
    _reader = State(
      initialValue: Reader(
        backend: backend, store: store, chain: backend is LocalBackend ? session.chain : nil,
        community: { [weak session] in session?.communityClient },
        onUnauthorized: { [weak session] in session?.sessionExpired() }))
  }

  var body: some View {
    let theme = currentTheme
    MainTabView()
      .environment(reader)
      .environment(\.theme, theme)
      .tint(theme.accent)
      .foregroundStyle(theme.text)
      .preferredColorScheme(theme.colorScheme)
      .task(id: scenePhase == .active) {
        guard scenePhase == .active else { return }
        system.update()
        await reader.start()
        await reader.listen()
      }
  }

  /// The palette for the mode in effect: the account's theme setting, or the
  /// system's when it's "System".
  private var currentTheme: AppTheme {
    let settings = reader.settings
    let mode: ColorMode =
      switch settings.theme {
      case .light: .light
      case .dark: .dark
      default: system.mode
      }
    let device = reader.device
    return AppTheme(
      palette: Theme.palette(mode, settings.appearance?[mode] ?? .init()),
      glass: (settings.glass ?? .default).normalized,
      serif: settings.readingFont == .serif,
      wallpaper: device.wallpaper.map {
        .init(image: $0, dim: device.wallpaperDim, blur: device.wallpaperBlur)
      })
  }
}

/// The system's light/dark setting, read from the window scene so the app's own
/// override (preferredColorScheme) doesn't feed back into it.
@MainActor @Observable
final class SystemAppearance {
  private(set) var mode: ColorMode = .light
  private var registered = false

  init() { update() }

  func update() {
    guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
    mode = scene.traitCollection.userInterfaceStyle == .dark ? .dark : .light
    guard !registered else { return }
    registered = true
    scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
      [weak self] (scene: UIWindowScene, _: UITraitCollection) in
      self?.mode = scene.traitCollection.userInterfaceStyle == .dark ? .dark : .light
    }
  }
}
