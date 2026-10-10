import PerchKit
import SafariServices
import SwiftUI
import WebKit

/// One article. Opening it marks it read; the bottom bar stars it, keeps it
/// unread, swaps in the full text from the site, sets the text size, shares,
/// opens the original, and moves on to the next article in the list. The bars
/// step aside while you scroll down and come back when you scroll up.
struct ArticleView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var article: Article
  /// The list it was opened from, for "next".
  private let list: ArticleList?

  @State private var fullText: FullText?
  @State private var showFullText = false
  @State private var loadingFullText = false
  @State private var fullTextError: String?
  @State private var safari: SafariTarget?
  @State private var hasNext = true
  @State private var barsHidden = false
  @State private var textSettings = false
  @State private var editingNote = false
  @State private var progress = ReadingProgress()

  init(article: Article, list: ArticleList? = nil) {
    _article = State(initialValue: article)
    self.list = list
  }

  private var current: Article { reader.current(article) }
  private var link: URL? { article.url.flatMap(URL.init(string:)) }

  var body: some View {
    ArticleWebView(
      html: ArticleHTML.page(
        article: article,
        feedTitle: reader.feed(article.feedId)?.displayTitle,
        body: showFullText ? fullText?.html : nil,
        note: reader.note(for: article).map { NoteMarkdown.html($0.body) },
        theme: theme),
      style: ArticleHTML.Style(
        size: reader.device.readerTextSize, leading: reader.device.readerLineHeight),
      baseURL: link,
      progress: progress,
      onLink: { url in
        if url.scheme == "http" || url.scheme == "https" { safari = SafariTarget(url: url) }
        if url.scheme == ArticleHTML.noteScheme { editingNote = true }
      },
      onScrollDirection: { down in
        // On iPad the article shares the screen with the list; its bars stay.
        guard sizeClass == .compact, down != barsHidden else { return }
        withAnimation(.easeInOut(duration: 0.25)) { barsHidden = down }
      }
    )
    .id(article.id)
    .transition(.push(from: .bottom))
    .background { Surface(clear: 0.28).ignoresSafeArea() }
    .ignoresSafeArea(edges: .bottom)
    .overlay(alignment: .top) { ProgressLine(progress: progress) }
    .background { Backdrop() }
    .navigationTitle(reader.feed(article.feedId)?.displayTitle ?? "")
    .toolbarTitleDisplayMode(.inline)
    // On iPhone the article's own bar takes the tab bar's place while
    // reading; on iPad the tabs stay, with the list beside the article.
    .toolbar(sizeClass == .compact ? .hidden : .automatic, for: .tabBar)
    .toolbarVisibility(barsHidden ? .hidden : .visible, for: .navigationBar, .bottomBar)
    .statusBarHidden(barsHidden)
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        Button(
          current.starred ? "Unstar" : "Star", systemImage: current.starred ? "star.fill" : "star"
        ) {
          Task { await reader.setStarred(article, !current.starred) }
        }
        .symbolEffect(.bounce, value: current.starred)
        Button(
          current.read ? "Keep unread" : "Mark read",
          systemImage: current.read ? "circle" : "checkmark.circle"
        ) {
          Task { await reader.setRead(article, !current.read) }
        }
        .contentTransition(.symbolEffect(.replace))
        Button(
          reader.note(for: article) == nil ? "Add a note" : "Edit note",
          systemImage: reader.note(for: article) == nil ? "square.and.pencil" : "note.text"
        ) { editingNote = true }
        if link != nil {
          Button(
            showFullText ? "Feed text" : "Full text",
            systemImage: showFullText ? "doc.plaintext.fill" : "doc.plaintext"
          ) { toggleFullText() }
          .symbolEffect(.pulse, isActive: loadingFullText)
        }
      }
      ToolbarSpacer(.flexible, placement: .bottomBar)
      ToolbarItemGroup(placement: .bottomBar) {
        Button("Text", systemImage: "textformat.size") { textSettings = true }
        if let link {
          ShareLink(item: link)
        }
        if list != nil {
          Button("Next article", systemImage: "chevron.down") { next() }
            .disabled(!hasNext)
        }
      }
      if let link {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Open in Safari", systemImage: "safari") { safari = SafariTarget(url: link) }
        }
      }
    }
    .sensoryFeedback(.impact(weight: .light), trigger: current.starred)
    .sensoryFeedback(.selection, trigger: article.id)
    .sheet(isPresented: $editingNote) {
      NoteEditorView(source: reader.noteSource(article))
    }
    .sheet(isPresented: $textSettings) {
      TextSettingsSheet()
        .presentationDetents([.height(250)])
    }
    .alert("Couldn't get the full text", isPresented: present($fullTextError)) {
      Button("OK") {}
    } message: {
      Text(fullTextError ?? "")
    }
    .fullScreenCover(item: $safari) { target in
      SafariView(url: target.url).ignoresSafeArea()
    }
    .task(id: article.id) { await reader.setRead(article, true) }
  }

  private func toggleFullText() {
    if showFullText || fullText != nil {
      showFullText.toggle()
      return
    }
    loadingFullText = true
    Task {
      defer { loadingFullText = false }
      do {
        fullText = try await reader.fullText(article)
        showFullText = true
      } catch {
        fullTextError =
          error as? LocalBackend.Failure == .noArticleText
          ? String(localized: "The page didn't have article text Perch could pick out.")
          : error.localizedDescription
      }
    }
  }

  private func next() {
    guard let list else { return }
    Task {
      guard let following = await list.article(after: article) else {
        hasNext = false
        return
      }
      withAnimation(.smooth(duration: 0.35)) {
        fullText = nil
        showFullText = false
        barsHidden = false
        progress.value = 0
        article = following
      }
    }
  }
}

/// How far down the article you've scrolled, 0–1. Its own object so scrolling
/// redraws only the progress line, not the whole article view.
@MainActor @Observable
final class ReadingProgress {
  var value: Double = 0
}

private struct ProgressLine: View {
  @Environment(\.theme) private var theme
  let progress: ReadingProgress

  var body: some View {
    GeometryReader { geo in
      theme.accent
        .frame(width: geo.size.width * progress.value, height: 2)
        .opacity(progress.value > 0.02 ? 1 : 0)
    }
    .frame(height: 2)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// Text size, line spacing and the reading font. Size and spacing stay on
/// this phone; the font follows the account like on the other clients.
private struct TextSettingsSheet: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme

  static let sizes: ClosedRange<Double> = 14...26
  static let spacings: [(String, Double)] = [("Tight", 1.4), ("Normal", 1.6), ("Roomy", 1.85)]

  var body: some View {
    @Bindable var device = reader.device
    VStack(spacing: 22) {
      Picker("Font", selection: font) {
        Text("Sans").tag(SyncedSettings.ReadingFont.sans)
        Text("Serif").tag(SyncedSettings.ReadingFont.serif)
      }
      .pickerStyle(.segmented)

      HStack(spacing: 16) {
        Button("Smaller", systemImage: "textformat.size.smaller") {
          device.readerTextSize = max(Self.sizes.lowerBound, device.readerTextSize - 1)
        }
        .labelStyle(.iconOnly)
        .disabled(device.readerTextSize <= Self.sizes.lowerBound)
        Slider(value: $device.readerTextSize, in: Self.sizes, step: 1)
        Button("Larger", systemImage: "textformat.size.larger") {
          device.readerTextSize = min(Self.sizes.upperBound, device.readerTextSize + 1)
        }
        .labelStyle(.iconOnly)
        .disabled(device.readerTextSize >= Self.sizes.upperBound)
      }
      .font(.title3)
      .sensoryFeedback(.selection, trigger: device.readerTextSize)

      Picker("Line spacing", selection: $device.readerLineHeight) {
        ForEach(Self.spacings, id: \.1) { name, value in
          Text(name).tag(value)
        }
      }
      .pickerStyle(.segmented)

      Button("Default size") {
        device.readerTextSize = 17
        device.readerLineHeight = 1.6
      }
      .font(.footnote)
      .disabled(device.readerTextSize == 17 && device.readerLineHeight == 1.6)
    }
    .padding(.horizontal, 24)
    .padding(.top, 28)
    .frame(maxHeight: .infinity, alignment: .top)
    .tint(theme.accent)
  }

  private var font: Binding<SyncedSettings.ReadingFont> {
    Binding(
      get: { reader.settings.readingFont ?? .sans },
      set: { font in Task { await reader.updateSettings(SyncedSettings(readingFont: font)) } })
  }
}

/// A page to show in Safari, as a sheet item.
private struct SafariTarget: Identifiable {
  let url: URL
  var id: String { url.absoluteString }
}

// MARK: - Web view

/// Renders article HTML with JavaScript off and a CSP that blocks scripts,
/// frames, forms and plugins: feed HTML is untrusted. Images come through
/// `perch-image:` (the image cache, so they work offline). Link taps come back
/// through `onLink` instead of navigating. Text size changes are applied in
/// place, so the page keeps its scroll position.
struct ArticleWebView: UIViewRepresentable {
  let html: String
  let style: ArticleHTML.Style
  let baseURL: URL?
  let progress: ReadingProgress
  let onLink: (URL) -> Void
  /// Called with true when you scroll down into the article, false when you
  /// scroll back up or reach either end.
  let onScrollDirection: (Bool) -> Void

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.defaultWebpagePreferences.allowsContentJavaScript = false
    config.websiteDataStore = .nonPersistent()
    config.allowsInlineMediaPlayback = true
    config.dataDetectorTypes = []
    config.setURLSchemeHandler(context.coordinator.images, forURLScheme: ImageCache.scheme)
    let view = WKWebView(frame: .zero, configuration: config)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    view.scrollView.delegate = context.coordinator
    view.navigationDelegate = context.coordinator
    view.allowsLinkPreview = true
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    let coordinator = context.coordinator
    coordinator.onLink = onLink
    coordinator.onScrollDirection = onScrollDirection
    coordinator.progress = progress
    if coordinator.loaded != html {
      coordinator.loaded = html
      coordinator.style = style
      coordinator.expectingLoad = true
      view.loadHTMLString(ArticleHTML.styled(html, style), baseURL: baseURL)
    } else if coordinator.style != style {
      coordinator.style = style
      // The app's own script; the page's scripts stay off.
      view.evaluateJavaScript(
        "document.documentElement.style.setProperty('--size','\(style.size)px');"
          + "document.documentElement.style.setProperty('--leading','\(style.leading)')")
    }
  }

  final class Coordinator: NSObject, WKNavigationDelegate, UIScrollViewDelegate {
    let images = ImageSchemeHandler()
    var loaded: String?
    var style: ArticleHTML.Style?
    var expectingLoad = false
    var onLink: (URL) -> Void = { _ in }
    var onScrollDirection: (Bool) -> Void = { _ in }
    var progress: ReadingProgress?
    private var lastOffset: CGFloat = 0

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      // Our own loadHTMLString is the only navigation allowed in place; a
      // <meta refresh> or similar in the feed's HTML is not.
      if expectingLoad, action.navigationType == .other, action.targetFrame?.isMainFrame == true {
        expectingLoad = false
        decisionHandler(.allow)
        return
      }
      if let url = action.request.url, action.navigationType == .linkActivated {
        if url.fragment != nil, url.absoluteString.hasPrefix(webView.url?.absoluteString ?? "-") {
          decisionHandler(.allow)
          return
        }
        onLink(url)
      }
      decisionHandler(.cancel)
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
      let offset = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
      let scrollable =
        scrollView.contentSize.height - scrollView.bounds.height
        + scrollView.adjustedContentInset.top + scrollView.adjustedContentInset.bottom
      let value = scrollable > 0 ? min(1, max(0, offset / scrollable)) : 0
      if abs((progress?.value ?? 0) - value) > 0.002 { progress?.value = value }

      // Only while the reader drags, so layout changes don't toggle the bars.
      guard scrollView.isTracking || scrollView.isDecelerating else {
        lastOffset = offset
        return
      }
      let delta = offset - lastOffset
      if offset < 40 || offset > scrollable - 40 {
        onScrollDirection(false)
      } else if delta > 12 {
        onScrollDirection(true)
      } else if delta < -12 {
        onScrollDirection(false)
      }
      if abs(delta) > 12 { lastOffset = offset }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
      lastOffset = scrollView.contentOffset.y + scrollView.adjustedContentInset.top
    }
  }
}

struct SafariView: UIViewControllerRepresentable {
  let url: URL

  func makeUIViewController(context: Context) -> SFSafariViewController {
    SFSafariViewController(url: url)
  }

  func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

// MARK: - HTML

enum ArticleHTML {
  /// Text size and line height, applied through CSS variables.
  struct Style: Equatable {
    var size: Double
    var leading: Double
  }

  private static let styleSlot = "/*perch-style*/"

  /// The page with the reader's text size filled in (in the stylesheet,
  /// which comes before the article).
  static func styled(_ page: String, _ style: Style) -> String {
    guard let slot = page.range(of: styleSlot) else { return page }
    return page.replacingCharacters(
      in: slot, with: "--size: \(style.size)px; --leading: \(style.leading);")
  }

  /// Links in the page with this scheme open the note editor.
  static let noteScheme = "perch-note"

  static func page(
    article: Article, feedTitle: String?, body: String?, note: String? = nil, theme: AppTheme
  ) -> String {
    let base = article.url.flatMap(URL.init(string:))
    // Tags that could change how the page loads; the CSP and disabled
    // JavaScript cover the rest.
    let raw = (body ?? article.contentHtml ?? article.summaryHtml ?? "")
      .replacing(/(?i)<\/?(meta|base|link|head|html|body)\b[^>]*>/, with: "")
    let content = proxyImages(raw, base: base)
    let date = article.published.formatted(date: .abbreviated, time: .shortened)
    let words = HTMLText.plain(raw, limit: .max).split(whereSeparator: \.isWhitespace).count
    let minutes =
      words > 120
      ? String(localized: "\(max(1, Int((Double(words) / 230).rounded()))) min read") : nil
    let meta = [feedTitle, article.author, date, minutes].compactMap { $0 }
      .filter { !$0.isEmpty }
      .map(escape).joined(separator: " · ")
    let p = theme.palette
    let font =
      theme.serif
      ? "ui-serif, 'New York', Georgia, serif"
      : "-apple-system, system-ui, 'Helvetica Neue', sans-serif"
    let rule = p.scheme == .dark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.12)"
    let code = p.scheme == .dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)"
    let title = escape(article.displayTitle)
    let heading = article.url.map { "<a href=\"\(escape($0))\">\(title)</a>" } ?? title

    return """
      <!doctype html>
      <html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src \(ImageCache.scheme): data:; media-src https: http:; style-src 'unsafe-inline'; font-src https:">
      <style>
      :root { color-scheme: \(p.scheme.rawValue); --text: \(p.text); --muted: \(p.textMuted); --link: \(p.accentText); --rule: \(rule); --code: \(code); \(styleSlot) }
      html { -webkit-text-size-adjust: 100%; }
      body { margin: 0; padding: 12px 20px 120px; background: transparent; color: var(--text); font-family: \(font); font-size: var(--size, 17px); line-height: var(--leading, 1.6); overflow-wrap: anywhere; }
      header, article { max-width: 42em; margin-left: auto; margin-right: auto; }
      header { margin-top: 8px; margin-bottom: 22px; }
      .meta { font: 600 13px/1.4 -apple-system, system-ui; color: var(--muted); margin: 0 0 8px; }
      h1.title { font: 700 calc(var(--size, 17px) * 1.5)/1.2 -apple-system, system-ui; letter-spacing: -0.01em; margin: 0; }
      h1.title a { color: inherit; text-decoration: none; }
      a { color: var(--link); text-underline-offset: 2px; }
      img, video, figure, svg, table { max-width: 100%; height: auto; }
      img, video { border-radius: 10px; }
      figure { margin: 1.2em 0; } figcaption { color: var(--muted); font-size: 14px; margin-top: 6px; }
      blockquote { margin: 1em 0; padding-left: 14px; border-left: 3px solid var(--rule); color: var(--muted); }
      pre { padding: 12px; border-radius: 10px; overflow-x: auto; background: var(--code); font-size: 14px; }
      code { font: 0.9em ui-monospace, Menlo, monospace; } :not(pre) > code { background: var(--code); padding: .1em .35em; border-radius: 6px; }
      hr { border: 0; border-top: 1px solid var(--rule); }
      h2, h3, h4 { line-height: 1.3; margin: 1.5em 0 .5em; }
      iframe, form, input, button, object, embed { display: none; }
      .note { margin-top: 18px; padding: 12px 14px; border-radius: 12px; border-left: 3px solid var(--link); background: var(--code); font-size: 15px; line-height: 1.5; }
      .note .label { display: block; font: 600 11px/1.4 -apple-system, system-ui; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); text-decoration: none; margin-bottom: 4px; }
      </style></head>
      <body>
      <header>
      <p class="meta">\(meta)</p>
      <h1 class="title">\(heading)</h1>
      \(note.map { "<div class=\"note\"><a class=\"label\" href=\"\(noteScheme):edit\">\(escape(String(localized: "Your note · Edit")))</a>\($0)</div>" } ?? "")
      </header>
      <article>\(content)</article>
      </body></html>
      """
  }

  /// Points every image at the image cache; `srcset` and `<source>` go, so
  /// nothing loads from the network behind the cache's back.
  static func proxyImages(_ html: String, base: URL?) -> String {
    html
      .replacing(/(?i)<source\b[^>]*>/, with: "")
      .replacing(/(?i)<img\b[^>]*>/) { match in
        var tag = String(match.0)
          .replacing(/(?i)\s(srcset|sizes|loading)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/, with: "")
        tag = tag.replacing(/(?i)\ssrc\s*=\s*("([^"]*)"|'([^']*)')/) { src in
          let value = String(src.2 ?? src.3 ?? "")
          guard
            let url = URL(string: HTMLText.decodeEntities(value), relativeTo: base)?.absoluteURL,
            url.scheme == "http" || url.scheme == "https"
          else { return " src=\"\"" }
          return " src=\"\(escape(ImageCache.proxied(url)))\""
        }
        return tag
      }
  }

  static func escape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }
}
