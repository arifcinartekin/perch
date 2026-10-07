import PerchKit
import SwiftUI

/// The first screen: All Feeds, Starred, and every feed grouped by category,
/// with unread counts. Glass bars float over the ember backdrop.
struct LibraryView: View {
  @Environment(Reader.self) private var reader
  @State private var path = NavigationPath()
  @State private var adding = false
  @State private var showingSettings = false
  @State private var removing: Feed?

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          row(.all, icon: "tray.full")
          row(.starred, icon: "star")
        }

        ForEach(reader.groups, id: \.category.id) { group in
          Section {
            if group.feeds.count > 1 {
              row(.category(group.category), icon: "folder")
            }
            ForEach(group.feeds) { feed in
              row(.feed(feed), icon: nil)
                .swipeActions {
                  Button("Unsubscribe", systemImage: "trash", role: .destructive) {
                    removing = feed
                  }
                }
            }
          } header: {
            Text(group.category.name)
          }
        }
      }
      .listStyle(.insetGrouped)
      .perchBackdrop()
      .overlay { emptyState }
      .refreshable { await reader.refresh() }
      .navigationTitle("Feeds")
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Image("PerchLogo")
            .resizable()
            .scaledToFit()
            .frame(width: 98, height: 30)
            .accessibilityLabel("Perch")
        }
        .sharedBackgroundVisibility(.hidden)
        ToolbarItemGroup(placement: .topBarTrailing) {
          Button("Add feed", systemImage: "plus") { adding = true }
          Button("Settings", systemImage: "gearshape") { showingSettings = true }
        }
      }
      .navigationDestination(for: Scope.self) { scope in
        ArticleListView(scope: scope, reader: reader)
      }
      .navigationDestination(for: Article.self) { article in
        ArticleView(article: article)
      }
      .sheet(isPresented: $adding) {
        AddFeedSheet { feed in path = NavigationPath([Scope.feed(feed)]) }
      }
      .sheet(isPresented: $showingSettings) { SettingsView() }
      .confirmationDialog(
        "Unsubscribe from \(removing?.displayTitle ?? "")?", isPresented: unsubscribing,
        titleVisibility: .visible
      ) {
        Button("Unsubscribe", role: .destructive) {
          if let feed = removing { Task { await reader.removeFeed(feed) } }
        }
      } message: {
        Text("Its articles go too, except the ones you starred.")
      }
      #if DEBUG
        .task { await openFromLaunchEnvironment() }
      #endif
      .alert("Couldn't reach your server", isPresented: hasError) {
        Button("OK") { reader.error = nil }
      } message: {
        Text(reader.error ?? "")
      }
    }
  }

  #if DEBUG
    /// Debug builds only, for simulator screenshots: PERCH_DEV_OPEN=all opens
    /// All Feeds, =article its newest article.
    private func openFromLaunchEnvironment() async {
      guard let open = ProcessInfo.processInfo.environment["PERCH_DEV_OPEN"], !open.isEmpty,
        path.isEmpty
      else {
        return
      }
      path.append(Scope.all)
      guard open == "article",
        let first = try? await reader.client.articles(.init(), limit: 1).items.first
      else { return }
      path.append(first)
    }
  #endif

  private func row(_ scope: Scope, icon: String?) -> some View {
    NavigationLink(value: scope) {
      HStack(spacing: 12) {
        if let icon {
          Image(systemName: icon)
            .foregroundStyle(Brand.ember)
            .frame(width: 26)
        } else if case .feed(let feed) = scope {
          FeedIcon(feed: feed)
        }
        Text(scope.title)
          .lineLimit(1)
        Spacer()
        if case .feed(let feed) = scope, feed.lastError != nil {
          Image(systemName: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
            .accessibilityLabel("Last refresh failed")
        }
        let n = reader.unread(scope)
        if n > 0 {
          Text(n, format: .number)
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
    }
    .listRowBackground(Rectangle().fill(.background.opacity(0.55)))
  }

  @ViewBuilder
  private var emptyState: some View {
    if reader.loaded && reader.library.feeds.isEmpty {
      ContentUnavailableView {
        Label {
          Text("Welcome to Perch")
        } icon: {
          Image("PerchMark").resizable().scaledToFit().frame(width: 72)
        }
      } description: {
        Text("Add your first feed: paste a site or feed address.")
      } actions: {
        Button("Add a feed") { adding = true }
          .buttonStyle(.glassProminent)
          .foregroundStyle(Brand.ink)
      }
      .padding(.top, 180)
    }
  }

  private var unsubscribing: Binding<Bool> {
    Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
  }

  private var hasError: Binding<Bool> {
    // Only for the library itself; lists show their own errors inline.
    Binding(
      get: { reader.error != nil && !reader.loaded },
      set: { if !$0 { reader.error = nil } })
  }
}

/// A feed's initial on an ember tile. No favicons: fetching them would tell
/// every site which feeds you read, which the other Perch clients avoid too.
struct FeedIcon: View {
  let feed: Feed
  var size: CGFloat = 22

  var body: some View {
    Text(String(feed.displayTitle.prefix(1)).uppercased())
      .font(.system(size: size * 0.55, weight: .semibold, design: .rounded))
      .foregroundStyle(Brand.ink)
      .frame(width: size, height: size)
      .background(Brand.ember.opacity(0.85), in: .rect(cornerRadius: size * 0.27))
      .frame(width: 26)
      .accessibilityHidden(true)
  }
}
