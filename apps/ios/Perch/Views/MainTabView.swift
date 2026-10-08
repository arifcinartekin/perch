import PerchKit
import SwiftUI

/// The tabs: unread articles, feeds, starred, settings, and search. The tab
/// bar is Liquid Glass and tucks away while you scroll.
struct MainTabView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var tab: TabID = Self.initialTab
  /// An article opened from a widget or notification.
  @State private var linked: Article?
  private let links = DeepLinks.shared

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
        ReadingColumns {
          ArticleListView(
            scope: .all, reader: reader, unreadOnly: true, title: String(localized: "Unread"))
        }
      }
      .badge(reader.unread(.all))

      Tab("Feeds", systemImage: "list.bullet", value: .feeds) {
        if sizeClass == .regular {
          LibrarySplitView()
        } else {
          LibraryView()
        }
      }

      Tab("Starred", systemImage: "star", value: .starred) {
        ReadingColumns {
          ArticleListView(scope: .starred, reader: reader)
        }
      }

      Tab("Settings", systemImage: "gearshape", value: .settings) {
        SettingsView()
      }

      Tab("Search", systemImage: "magnifyingglass", value: .search, role: .search) {
        ReadingColumns {
          ArticleListView(
            scope: .all, reader: reader, title: String(localized: "Search"), searchOnly: true)
        }
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .solidBarsWhenGlassIsOff()
    .sheet(item: $linked) { article in
      NavigationStack {
        ArticleView(article: article)
          .toolbar {
            ToolbarItem(placement: .topBarLeading) {
              Button("Close", systemImage: "xmark") { linked = nil }
            }
          }
      }
    }
    .task(id: links.pending) { await openLink() }
  }

  private func openLink() async {
    guard let url = links.pending else { return }
    links.pending = nil
    tab = .unread
    guard let (feedId, articleId) = WidgetSnapshot.article(in: url) else { return }
    linked = await reader.article(feedId: feedId, id: articleId)
  }
}

/// An article list that pushes articles on iPhone, and on iPad keeps them
/// beside it, in a split view.
struct ReadingColumns<Content: View>: View {
  @Environment(\.horizontalSizeClass) private var sizeClass
  @ViewBuilder let list: () -> Content

  var body: some View {
    if sizeClass == .regular {
      NavigationSplitView {
        list()
          .navigationSplitViewColumnWidth(min: 320, ideal: 400, max: 480)
      } detail: {
        NoArticleSelected()
      }
    } else {
      NavigationStack { list() }
    }
  }
}

/// The Feeds tab on iPad: feeds, the chosen feed's articles, and the article.
private struct LibrarySplitView: View {
  @Environment(Reader.self) private var reader
  @State private var scope: Scope? = .all

  var body: some View {
    NavigationSplitView {
      LibraryView(selection: $scope)
        .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
    } content: {
      Group {
        if let scope {
          ArticleListView(scope: scope, reader: reader).id(scope)
        } else {
          NoArticleSelected()
        }
      }
      .navigationSplitViewColumnWidth(min: 320, ideal: 400, max: 480)
    } detail: {
      NoArticleSelected()
    }
    // An unsubscribed feed can't stay selected.
    .onChange(of: reader.library.feeds) {
      if case .feed(let feed) = scope, reader.feed(feed.id) == nil { scope = .all }
    }
  }
}

/// The empty reading pane on iPad.
struct NoArticleSelected: View {
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(spacing: 14) {
      Image("PerchMark")
        .resizable()
        .scaledToFit()
        .frame(width: 84)
        .opacity(0.5)
      Text("Choose an article to read")
        .font(.title3.weight(.medium))
        .foregroundStyle(theme.muted)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { Backdrop() }
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
