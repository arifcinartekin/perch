import PerchKit
import SwiftUI

@main
struct PerchApp: App {
  @State private var session = Session()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
        .tint(Brand.ember)
    }
  }
}

struct RootView: View {
  @Environment(Session.self) private var session

  var body: some View {
    switch session.phase {
    case .restoring:
      Backdrop()
    case .signedOut:
      ConnectView()
    case .signedIn:
      if let client = session.client {
        SignedInView(client: client, session: session)
          // A new session (other account or server) starts from scratch.
          .id(ObjectIdentifier(client))
      }
    }
  }
}

/// Holds the Reader for one session and keeps it live while the app is active.
private struct SignedInView: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var reader: Reader

  init(client: APIClient, session: Session) {
    _reader = State(
      initialValue: Reader(
        client: client, onUnauthorized: { [weak session] in session?.sessionExpired() }))
  }

  var body: some View {
    LibraryView()
      .environment(reader)
      .preferredColorScheme(colorScheme)
      .task(id: scenePhase == .active) {
        guard scenePhase == .active else { return }
        await reader.load()
        await reader.listen()
      }
  }

  /// The theme chosen in Perch's settings (synced from the other clients).
  private var colorScheme: ColorScheme? {
    switch reader.settings.theme {
    case .light: .light
    case .dark: .dark
    default: nil
    }
  }
}
