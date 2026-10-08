import PerchKit
import SwiftUI

/// The tabs: unread articles, feeds, starred, settings, and search. The tab
/// bar is Liquid Glass and tucks away while you scroll.
struct MainTabView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var tab: TabID = Self.initialTab

  enum TabID: String, Hashable { case unread, feeds, starred, settings, search }

  private static var initialTab: TabID {
    #if DEBUG
      // Simulator screenshots: PERCH_DEV_TAB=feeds|starred|settings|search.
      if let tab = ProcessInfo.processInfo.environment["PERCH_DEV_TAB"].flatMap(TabID.init) {
        return tab
      }
    #endif
    return .unread
  }

  var body: some View {
    TabView(selection: $tab) {
      Tab("Unread", systemImage: "tray.full", value: .unread) {
        NavigationStack {
          ArticleListView(scope: .all, reader: reader, unreadOnly: true, title: "Unread")
        }
      }
      .badge(reader.unread(.all))

      Tab("Feeds", systemImage: "list.bullet", value: .feeds) {
        LibraryView()
      }

      Tab("Starred", systemImage: "star", value: .starred) {
        NavigationStack {
          ArticleListView(scope: .starred, reader: reader)
        }
      }

      Tab("Settings", systemImage: "gearshape", value: .settings) {
        SettingsView()
      }

      Tab(value: .search, role: .search) {
        NavigationStack {
          ArticleListView(scope: .all, reader: reader, title: "Search", searchOnly: true)
        }
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .solidBarsWhenGlassIsOff()
  }
}

extension View {
  /// With glass turned off in Settings, bars get the palette's solid colour.
  func solidBarsWhenGlassIsOff() -> some View {
    modifier(SolidBars())
  }
}

private struct SolidBars: ViewModifier {
  @Environment(\.theme) private var theme

  func body(content: Content) -> some View {
    if theme.glass.enabled {
      content
    } else {
      content
        .toolbarBackgroundVisibility(.visible, for: .navigationBar, .tabBar)
        .toolbarBackground(theme.solid, for: .navigationBar, .tabBar)
    }
  }
}

/// "Offline" note at the bottom of a list while the server can't be reached.
struct OfflineNotice: View {
  @Environment(Reader.self) private var reader

  var body: some View {
    if reader.isOffline {
      Label("Offline · showing what's saved on this iPhone", systemImage: "icloud.slash")
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: .capsule)
        .padding(.bottom, 6)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
  }
}
