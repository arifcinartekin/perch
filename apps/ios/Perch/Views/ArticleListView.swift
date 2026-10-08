import PerchKit
import SwiftUI

/// The articles in one scope, newest first: from the server, or from the
/// phone when offline.
struct ArticleListView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var list: ArticleList
  @State private var confirmingMarkAll = false
  /// Bumped by swipe actions, for a tap of haptic feedback.
  @State private var swiped = 0
  @State private var addingFeed = false
  private let title: String
  /// The Search tab: nothing until you type.
  private let searchOnly: Bool

  init(
    scope: Scope, reader: Reader, unreadOnly: Bool = false, title: String? = nil,
    searchOnly: Bool = false
  ) {
    _list = State(initialValue: ArticleList(scope: scope, reader: reader, unreadOnly: unreadOnly))
    self.title = title ?? scope.title
    self.searchOnly = searchOnly
  }

  var body: some View {
    List {
      ForEach(visibleItems) { item in
        let article = reader.current(item)
        NavigationLink {
          ArticleView(article: item, list: list)
        } label: {
          ArticleRow(article: article, showFeed: !isSingleFeed)
        }
        .navigationLinkIndicatorVisibility(.hidden)
        .listRowBackground(Color.clear)
        .swipeActions(edge: .leading) {
          Button(
            article.read ? "Unread" : "Read",
            systemImage: article.read ? "circle.fill" : "checkmark.circle"
          ) {
            swiped += 1
            Task { await reader.setRead(item, !article.read) }
          }
          .tint(.gray)
        }
        .swipeActions(edge: .trailing) {
          Button(
            article.starred ? "Unstar" : "Star",
            systemImage: article.starred ? "star.slash" : "star"
          ) {
            swiped += 1
            Task { await reader.setStarred(item, !article.starred) }
          }
          .tint(theme.accent)
        }
        .contextMenu {
          if let url = article.url.flatMap(URL.init(string:)) {
            ShareLink(item: url)
            Button("Copy link", systemImage: "link") { UIPasteboard.general.url = url }
          }
        }
        .onAppear {
          if item.id == list.items.last?.id { Task { await list.loadMore() } }
        }
      }
      if list.loading && !list.items.isEmpty {
        ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
      }
    }
    .listStyle(.plain)
    .sensoryFeedback(.impact(weight: .light), trigger: swiped)
    .perchBackdrop()
    .overlay { placeholder }
    .safeAreaInset(edge: .bottom) { OfflineNotice() }
    .navigationTitle(title)
    .toolbarTitleDisplayMode(isSingleFeed ? .inline : .large)
    .searchable(text: $list.search, prompt: searchOnly ? "Search your articles" : "Search \(title)")
    .refreshable { await reader.refresh(list.scope) }
    .toolbar {
      if !searchOnly {
        ToolbarItemGroup(placement: .topBarTrailing) {
          Menu {
            Picker("Show", selection: $list.unreadOnly) {
              Label("Unread", systemImage: "circle.inset.filled").tag(true)
              Label("All articles", systemImage: "tray.full").tag(false)
            }
          } label: {
            Label(
              "Show",
              systemImage: list.unreadOnly
                ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
          }
          if list.scope != .starred {
            Button("Mark all as read", systemImage: "checkmark.circle") {
              confirmingMarkAll = true
            }
            .disabled(reader.unread(list.scope) == 0)
          }
        }
      }
    }
    .sheet(isPresented: $addingFeed) { AddFeedSheet { _ in } }
    .confirmationDialog(
      "Mark all \(reader.unread(list.scope)) articles in \(title) as read?",
      isPresented: $confirmingMarkAll, titleVisibility: .visible
    ) {
      Button("Mark all as read") {
        Task { await reader.markAllRead(list.scope, upTo: list.loadedAt) }
      }
    }
    // Reload on filter or search changes (debounced) and when the server says
    // articles changed.
    .task(id: ReloadKey(unreadOnly: list.unreadOnly, search: list.search)) {
      if searchOnly && list.search.isEmpty { return }
      if !list.items.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
      guard !Task.isCancelled else { return }
      await list.reload()
    }
    .onChange(of: reader.articlesVersion) {
      Task { await list.reload() }
    }
  }

  private struct ReloadKey: Hashable {
    var unreadOnly: Bool
    var search: String
  }

  private var visibleItems: [Article] {
    searchOnly && list.search.isEmpty ? [] : list.items
  }

  private var isSingleFeed: Bool {
    if case .feed = list.scope { return true }
    return false
  }

  @ViewBuilder
  private var placeholder: some View {
    if visibleItems.isEmpty {
      if searchOnly && list.search.isEmpty {
        ContentUnavailableView(
          "Search your articles", systemImage: "magnifyingglass",
          description: Text("Titles, authors and text, in every feed."))
      } else if reader.loaded && reader.library.feeds.isEmpty {
        ContentUnavailableView {
          Label {
            Text("Nothing to read yet")
          } icon: {
            Image("PerchMark").resizable().scaledToFit().frame(width: 72)
          }
        } description: {
          Text("Add a feed and its newest articles show up here.")
        } actions: {
          Button("Add a feed") { addingFeed = true }
            .buttonStyle(.glassProminent)
            .tint(theme.button)
            .foregroundStyle(theme.buttonContrast)
        }
      } else if list.loading {
        SkeletonRows()
      } else if let error = list.error {
        ContentUnavailableView(
          "Couldn't load articles", systemImage: "wifi.exclamationmark", description: Text(error))
      } else if !list.search.isEmpty {
        ContentUnavailableView.search(text: list.search)
      } else if list.unreadOnly {
        ContentUnavailableView(
          "All caught up", systemImage: "checkmark.circle",
          description: Text("No unread articles here."))
      } else if list.scope == .starred {
        ContentUnavailableView(
          "No starred articles", systemImage: "star",
          description: Text(
            "Swipe left on an article, or tap the star while reading, to keep it here."))
      } else {
        ContentUnavailableView(
          "No articles yet", systemImage: "tray",
          description: Text("Pull down to fetch the latest."))
      }
    }
  }
}

/// Grey stand-ins for article rows while the first page loads.
private struct SkeletonRows: View {
  @Environment(\.theme) private var theme
  @State private var pulse = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(0..<7, id: \.self) { i in
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 8) {
            bar(width: 140, height: 10)
            bar(width: i % 2 == 0 ? 280 : 230, height: 14)
            bar(width: i % 3 == 0 ? 180 : 250, height: 14)
            bar(width: 300, height: 10).opacity(0.7)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if i % 3 != 1 {
            RoundedRectangle(cornerRadius: 12).fill(theme.text.opacity(0.07))
              .frame(width: 72, height: 72)
          }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 20)
      }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .opacity(pulse ? 0.45 : 1)
    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
    .onAppear { pulse = true }
    .accessibilityLabel("Loading articles")
    .allowsHitTesting(false)
  }

  private func bar(width: CGFloat, height: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: height / 2)
      .fill(theme.text.opacity(0.08))
      .frame(maxWidth: width, minHeight: height, maxHeight: height)
  }
}

struct ArticleRow: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  let article: Article
  var showFeed = true

  var body: some View {
    let preview = ArticlePreview.of(article)
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 5) {
        HStack(spacing: 6) {
          if !article.read {
            Circle()
              .fill(theme.accent)
              .frame(width: 7, height: 7)
              .transition(.scale.combined(with: .opacity))
              .accessibilityLabel("Unread")
          }
          if showFeed, let feed = reader.feed(article.feedId) {
            FeedIcon(feed: feed, size: 16, slot: 16)
            Text(feed.displayTitle).lineLimit(1).layoutPriority(-1)
            Text("·")
          }
          Text(
            article.published, format: .relative(presentation: .named, unitsStyle: .abbreviated)
          )
          .lineLimit(1)
          .fixedSize()
          Spacer(minLength: 0)
          if article.starred {
            Image(systemName: "star.fill")
              .foregroundStyle(theme.accent)
              .accessibilityLabel("Starred")
              .transition(.scale.combined(with: .opacity))
          }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(theme.faint)

        Text(article.displayTitle)
          .font(.headline.weight(article.read ? .medium : .semibold))
          .foregroundStyle(article.read ? theme.muted : theme.text)
          .lineLimit(3)
          .fixedSize(horizontal: false, vertical: true)

        if !preview.text.isEmpty {
          Text(preview.text)
            .font(.subheadline)
            .foregroundStyle(theme.muted)
            .lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      if reader.device.listImages, let image = preview.image {
        Thumbnail(url: image)
      }
    }
    .padding(.vertical, 6)
    .opacity(article.read ? 0.72 : 1)
    .animation(.snappy, value: article.read)
    .animation(.snappy, value: article.starred)
    .accessibilityElement(children: .combine)
  }
}

/// An article's picture in a list row. Rows without one, or whose picture
/// can't be loaded, simply go without.
private struct Thumbnail: View {
  @Environment(\.theme) private var theme
  @Environment(\.displayScale) private var scale
  let url: URL
  @State private var image: UIImage?
  @State private var failed = false
  private static let side: CGFloat = 72

  var body: some View {
    if !failed {
      ZStack {
        if let image {
          Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .transition(.opacity)
        } else {
          theme.text.opacity(0.06)
        }
      }
      .frame(width: Self.side, height: Self.side)
      .clipShape(.rect(cornerRadius: 12))
      .overlay {
        RoundedRectangle(cornerRadius: 12).strokeBorder(theme.text.opacity(0.08), lineWidth: 0.5)
      }
      .padding(.top, 2)
      .accessibilityHidden(true)
      .task(id: url) {
        if let hit = Thumbnails.cached(url) {
          image = hit
          return
        }
        let loaded = await Thumbnails.load(url, pixels: Int(Self.side * scale * 1.5))
        withAnimation(.easeOut(duration: 0.2)) {
          if let loaded { image = loaded } else { failed = true }
        }
      }
    }
  }
}
