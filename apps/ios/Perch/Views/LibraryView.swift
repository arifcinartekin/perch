import PerchKit
import SwiftUI

/// The Feeds tab: All Feeds, Starred, and every feed grouped by category, with
/// unread counts. Categories fold away; long-press a feed or tap a category's
/// menu to edit, mark read, rename or delete. On iPhone it pushes the article
/// list; on iPad it's the sidebar and sets `selection` instead.
struct LibraryView: View {
  /// Set when this is the iPad sidebar.
  var selection: Binding<Scope?>?

  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var path = NavigationPath()
  @State private var adding = false
  @State private var editing: Feed?
  @State private var removing: Feed?
  @State private var naming: CategoryNaming?
  @State private var deleting: PerchKit.Category?
  @State private var markingRead: Scope?

  /// The new-category / rename prompt.
  struct CategoryNaming: Identifiable {
    var category: PerchKit.Category?
    var name: String
    var id: String { category?.id ?? "new" }
  }

  var body: some View {
    if selection != nil {
      library
    } else {
      NavigationStack(path: $path) {
        library
          .navigationDestination(for: Scope.self) { scope in
            ArticleListView(scope: scope, reader: reader)
          }
          .navigationDestination(for: Article.self) { article in
            ArticleView(article: article)
          }
      }
    }
  }

  @ViewBuilder
  private var rows: some View {
    Section {
      row(.all, icon: "tray.full")
      row(.starred, icon: "star")
      NavigationLink {
        NotesListView()
      } label: {
        HStack(spacing: 12) {
          Image(systemName: "note.text")
            .foregroundStyle(theme.accent)
            .frame(width: 26)
          Text("Notes")
          Spacer()
          if !reader.notes.isEmpty {
            Text("\(reader.notes.count)").foregroundStyle(theme.muted).monospacedDigit()
          }
        }
      }
    }

    ForEach(reader.groups, id: \.category.id) { group in
      Section(isExpanded: expanded(group.category)) {
        ForEach(group.feeds) { feed in
          row(.feed(feed), icon: nil)
            .contextMenu { feedMenu(feed) }
            .swipeActions {
              Button("Unsubscribe", systemImage: "trash", role: .destructive) {
                removing = feed
              }
              Button("Edit", systemImage: "pencil") { editing = feed }
            }
        }
      } header: {
        categoryHeader(group.category, feeds: group.feeds)
      }
    }
  }

  private var library: some View {
    Group {
      if let selection {
        List(selection: selection) { rows }
      } else {
        List { rows }
      }
    }
    .listStyle(.sidebar)
    .perchBackdrop()
    .overlay { emptyState }
    .safeAreaInset(edge: .bottom) { OfflineNotice() }
    .refreshable { await reader.refresh() }
    .navigationTitle("Feeds")
    .toolbar {
      // No room for the logo beside the sidebar button on iPad.
      if selection == nil {
        LogoToolbarItem()
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu("Add", systemImage: "plus") {
          Button("Add a feed", systemImage: "dot.radiowaves.up.forward") { adding = true }
          Button("New category", systemImage: "folder.badge.plus") {
            naming = CategoryNaming(name: "")
          }
        } primaryAction: {
          adding = true
        }
      }
    }
    .sheet(isPresented: $adding) {
      AddFeedSheet { feed in show(.feed(feed)) }
    }
    .sheet(item: $editing) { feed in FeedEditSheet(feed: feed) }
    .confirmationDialog(
      "Unsubscribe from \(removing?.displayTitle ?? "")?", isPresented: present($removing),
      titleVisibility: .visible
    ) {
      Button("Unsubscribe", role: .destructive) {
        if let feed = removing { Task { await reader.removeFeed(feed) } }
      }
    } message: {
      Text("Its articles go too, except the ones you starred.")
    }
    .confirmationDialog(
      "Delete \(deleting?.name ?? "")?", isPresented: present($deleting),
      titleVisibility: .visible
    ) {
      Button("Delete category", role: .destructive) {
        if let c = deleting { Task { await reader.deleteCategory(c) } }
      }
    } message: {
      Text("Its feeds move to Uncategorized.")
    }
    .confirmationDialog(
      "Mark all in \(markingRead?.title ?? "") as read?", isPresented: present($markingRead),
      titleVisibility: .visible
    ) {
      Button("Mark all as read") {
        if let scope = markingRead { Task { await reader.markAllRead(scope, upTo: .now) } }
      }
    }
    .alert(
      naming?.category == nil ? "New category" : "Rename category",
      isPresented: present($naming)
    ) {
      TextField("Name", text: Binding(get: { naming?.name ?? "" }, set: { naming?.name = $0 }))
      Button("Cancel", role: .cancel) {}
      Button(naming?.category == nil ? "Create" : "Rename") { saveCategoryName() }
    }
    .alert("Something went wrong", isPresented: hasError) {
      Button("OK") { reader.error = nil }
    } message: {
      Text(reader.error ?? "")
    }
    #if DEBUG
      .task { await openFromLaunchEnvironment() }
    #endif
  }

  private func show(_ scope: Scope) {
    if let selection {
      selection.wrappedValue = scope
    } else {
      path = NavigationPath([scope])
    }
  }

  // MARK: Rows

  private func row(_ scope: Scope, icon: String?) -> some View {
    NavigationLink(value: scope) {
      HStack(spacing: 12) {
        if let icon {
          Image(systemName: icon)
            .foregroundStyle(theme.accent)
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
            .foregroundStyle(theme.muted)
        }
      }
    }
    // Rows draw their own background, so the sidebar's selection is drawn
    // here too.
    .listRowBackground(
      ZStack {
        Surface()
        if selection?.wrappedValue == scope { theme.accent.opacity(0.2) }
      })
  }

  @ViewBuilder
  private func feedMenu(_ feed: Feed) -> some View {
    Button("Edit…", systemImage: "pencil") { editing = feed }
    Button("Mark all as read", systemImage: "checkmark.circle") { markingRead = .feed(feed) }
    Button("Refresh", systemImage: "arrow.clockwise") {
      Task { await reader.refresh(.feed(feed)) }
    }
    Button("Copy feed address", systemImage: "doc.on.doc") {
      UIPasteboard.general.string = feed.url
    }
    if let error = feed.lastError {
      Section("Last refresh failed") { Text(error) }
    }
    Divider()
    Button("Unsubscribe", systemImage: "trash", role: .destructive) { removing = feed }
  }

  private func categoryHeader(_ category: PerchKit.Category, feeds: [Feed]) -> some View {
    HStack {
      Text(category.displayName)
      Spacer()
      let unread = reader.unread(.category(category))
      if unread > 0, reader.isCollapsed(category) {
        Text(unread, format: .number).monospacedDigit()
      }
      Menu {
        NavigationLink(value: Scope.category(category)) {
          Label("Show all articles", systemImage: "list.bullet")
        }
        Button("Mark all as read", systemImage: "checkmark.circle") {
          markingRead = .category(category)
        }
        .disabled(unread == 0)
        if category.id != uncategorizedId {
          Button("Rename…", systemImage: "pencil") {
            naming = CategoryNaming(category: category, name: category.name)
          }
          Button("Delete…", systemImage: "trash", role: .destructive) { deleting = category }
        }
      } label: {
        Image(systemName: "ellipsis.circle")
          .accessibilityLabel("\(category.displayName) options")
      }
      .disabled(feeds.isEmpty && category.id == uncategorizedId)
    }
  }

  private func expanded(_ category: PerchKit.Category) -> Binding<Bool> {
    Binding(
      get: { !reader.isCollapsed(category) },
      set: { reader.setCollapsed(category, !$0) })
  }

  private func saveCategoryName() {
    guard let naming else { return }
    let name = naming.name.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty else { return }
    Task {
      if let category = naming.category {
        await reader.renameCategory(category, to: name)
      } else {
        do {
          _ = try await reader.addCategory(name)
        } catch {
          reader.error = error.localizedDescription
        }
      }
    }
  }

  @ViewBuilder
  private var emptyState: some View {
    if reader.loaded && reader.library.feeds.isEmpty {
      ContentUnavailableView {
        Label {
          Text("Welcome to Perch")
        } icon: {
          PerchMark().frame(width: 72)
        }
      } description: {
        Text("Add your first feed: paste a site or feed address.")
      } actions: {
        Button("Add a feed") { adding = true }
          .buttonStyle(.glassProminent)
          .tint(theme.button)
          .foregroundStyle(theme.buttonContrast)
      }
      .padding(.top, 180)
    }
  }

  private var hasError: Binding<Bool> {
    Binding(get: { reader.error != nil }, set: { if !$0 { reader.error = nil } })
  }

  #if DEBUG
    /// Debug builds only, for simulator screenshots: PERCH_DEV_OPEN=all opens
    /// All Feeds, =article its newest article, =article:<search> the newest
    /// match, =feed:<title> the first feed whose title starts with it.
    private func openFromLaunchEnvironment() async {
      guard let open = ProcessInfo.processInfo.environment["PERCH_DEV_OPEN"], path.isEmpty
      else { return }
      if open.hasPrefix("feed:") {
        let prefix = open.dropFirst(5).lowercased()
        if let feed = reader.library.feeds.first(where: {
          $0.displayTitle.lowercased().hasPrefix(prefix)
        }) {
          show(.feed(feed))
        }
        return
      }
      guard selection == nil else { return }
      guard open == "all" || open.hasPrefix("article") else { return }
      path.append(Scope.all)
      // article, or article:<search> for the newest match.
      let search = open.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init)
      guard open.hasPrefix("article"),
        let first = try? await reader.backend.articles(.init(search: search), before: nil, limit: 1)
          .items.first
      else { return }
      path.append(first)
    }
  #endif
}

/// A Binding<Bool> that is true while an optional is set, for dialogs.
func present<T: Sendable>(_ value: Binding<T?>) -> Binding<Bool> {
  Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
}

/// A feed's initial on an accent tile. No favicons: fetching them would tell
/// every site which feeds you read, which the other Perch clients avoid too.
struct FeedIcon: View {
  @Environment(\.theme) private var theme
  let feed: Feed
  var size: CGFloat = 22
  /// Width the icon is centred in, so sidebar rows line up.
  var slot: CGFloat = 26

  var body: some View {
    Text(String(feed.displayTitle.prefix(1)).uppercased())
      .font(.system(size: size * 0.55, weight: .semibold, design: .rounded))
      .foregroundStyle(theme.accentContrast)
      .frame(width: size, height: size)
      .background(theme.accent.opacity(0.85), in: .rect(cornerRadius: size * 0.27))
      .frame(width: max(size, slot))
      .accessibilityHidden(true)
  }
}
