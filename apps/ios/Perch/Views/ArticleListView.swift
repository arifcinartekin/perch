import PerchKit
import SwiftUI

/// The articles in one scope, newest first: from the server, or from the
/// phone when offline.
struct ArticleListView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var list: ArticleList
  @State private var confirmingMarkAll = false
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
        .listRowBackground(Color.clear)
        .swipeActions(edge: .leading) {
          Button(
            article.read ? "Unread" : "Read",
            systemImage: article.read ? "circle.fill" : "checkmark.circle"
          ) {
            Task { await reader.setRead(item, !article.read) }
          }
          .tint(.gray)
        }
        .swipeActions(edge: .trailing) {
          Button(
            article.starred ? "Unstar" : "Star",
            systemImage: article.starred ? "star.slash" : "star"
          ) {
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
    .perchBackdrop()
    .overlay { placeholder }
    .safeAreaInset(edge: .bottom) { OfflineNotice() }
    .navigationTitle(title)
    .toolbarTitleDisplayMode(searchOnly ? .large : .inline)
    .searchable(text: $list.search, prompt: searchOnly ? "Search your articles" : "Search \(title)")
    .refreshable { await reader.refresh(list.scope) }
    .toolbar {
      if !searchOnly {
        ToolbarItemGroup(placement: .topBarTrailing) {
          Toggle(isOn: $list.unreadOnly) {
            Label("Unread only", systemImage: "line.3.horizontal.decrease")
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
      } else if list.loading {
        ProgressView()
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

struct ArticleRow: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  let article: Article
  var showFeed = true

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Circle()
        .fill(article.read ? .clear : theme.accent)
        .frame(width: 8, height: 8)
        .padding(.top, 7)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          if showFeed, let feed = reader.feed(article.feedId) {
            Text(feed.displayTitle).lineLimit(1)
            Text("·")
          }
          Text(
            article.published, format: .relative(presentation: .named, unitsStyle: .abbreviated)
          )
          .lineLimit(1)
          Spacer(minLength: 0)
          if article.starred {
            Image(systemName: "star.fill").foregroundStyle(theme.accent)
              .accessibilityLabel("Starred")
          }
        }
        .font(.caption)
        .foregroundStyle(theme.faint)

        Text(article.displayTitle)
          .font(.body.weight(article.read ? .regular : .semibold))
          .foregroundStyle(article.read ? theme.muted : theme.text)
          .lineLimit(3)

        if let summary, !summary.isEmpty {
          Text(summary)
            .font(.subheadline)
            .foregroundStyle(theme.muted)
            .lineLimit(2)
        }
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private var summary: String? {
    guard let html = article.summaryHtml ?? article.contentHtml else { return nil }
    return HTMLText.plain(html, limit: 200)
  }
}
