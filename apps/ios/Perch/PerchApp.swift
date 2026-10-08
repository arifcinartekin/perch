import PerchKit
import SwiftUI
import UIKit

@main
struct PerchApp: App {
  @State private var session = Session()
  @Environment(\.scenePhase) private var scenePhase

  init() {
    BackgroundRefresh.register()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .background { BackgroundRefresh.schedule() }
    }
  }
}

struct RootView: View {
  @Environment(Session.self) private var session
  @Environment(\.colorScheme) private var colorScheme

  /// Before signing in there are no account settings: the default palette
  /// for the system's light or dark mode.
  private var signedOutTheme: AppTheme {
    var theme = AppTheme.default
    theme.palette = Theme.palette(colorScheme == .dark ? .dark : .light)
    return theme
  }

  var body: some View {
    switch session.phase {
    case .restoring:
      Backdrop()
        .environment(\.theme, signedOutTheme)
    case .signedOut:
      ConnectView()
        .environment(\.theme, signedOutTheme)
        .tint(Brand.ember)
    case .signedIn:
      if let client = session.client, let store = session.store {
        SignedInView(client: client, store: store, session: session)
          // A new session (other account or server) starts from scratch.
          .id(ObjectIdentifier(client))
      }
    }
  }
}

/// Holds the Reader for one session, applies the account's look, and keeps
/// things live while the app is active.
private struct SignedInView: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var reader: Reader
  @State private var system = SystemAppearance()

  init(client: APIClient, store: OfflineStore, session: Session) {
    _reader = State(
      initialValue: Reader(
        client: client, store: store,
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
