import PerchKit
import SafariServices
import SwiftUI
import WebKit

/// One article. Opening it marks it read; the bottom bar stars it, keeps it
/// unread, swaps in the full text from the site, shares, opens the original,
/// and moves on to the next article in the list.
struct ArticleView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var article: Article
  /// The list it was opened from, for "next".
  private let list: ArticleList?

  @State private var fullText: FullText?
  @State private var showFullText = false
  @State private var loadingFullText = false
  @State private var fullTextError: String?
  @State private var safari: SafariTarget?
  @State private var hasNext = true

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
        theme: theme),
      baseURL: link,
      onLink: { url in
        if url.scheme == "http" || url.scheme == "https" { safari = SafariTarget(url: url) }
      }
    )
    .background { Surface(clear: 0.28).ignoresSafeArea() }
    .ignoresSafeArea(edges: .bottom)
    .background { Backdrop() }
    .navigationTitle(reader.feed(article.feedId)?.displayTitle ?? "")
    .toolbarTitleDisplayMode(.inline)
    // The article's own bar takes the tab bar's place while reading.
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      ToolbarItemGroup(placement: .bottomBar) {
        Button(
          current.starred ? "Unstar" : "Star", systemImage: current.starred ? "star.fill" : "star"
        ) {
          Task { await reader.setStarred(article, !current.starred) }
        }
        Button(
          current.read ? "Keep unread" : "Mark read",
          systemImage: current.read ? "circle" : "checkmark.circle"
        ) {
          Task { await reader.setRead(article, !current.read) }
        }
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
        if let link {
          ShareLink(item: link)
          Button("Open in Safari", systemImage: "safari") { safari = SafariTarget(url: link) }
        }
        if list != nil {
          Button("Next article", systemImage: "chevron.down") { next() }
            .disabled(!hasNext)
        }
      }
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
        fullTextError = error.localizedDescription
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
      fullText = nil
      showFullText = false
      article = following
    }
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
/// through `onLink` instead of navigating.
struct ArticleWebView: UIViewRepresentable {
  let html: String
  let baseURL: URL?
  let onLink: (URL) -> Void

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
    view.navigationDelegate = context.coordinator
    view.allowsLinkPreview = true
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    context.coordinator.onLink = onLink
    guard context.coordinator.loaded != html else { return }
    let isNewArticle = context.coordinator.baseURL != baseURL
    context.coordinator.loaded = html
    context.coordinator.baseURL = baseURL
    context.coordinator.expectingLoad = true
    view.loadHTMLString(html, baseURL: baseURL)
    if isNewArticle { view.scrollView.setContentOffset(.zero, animated: false) }
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    let images = ImageSchemeHandler()
    var loaded: String?
    var baseURL: URL?
    var expectingLoad = false
    var onLink: (URL) -> Void = { _ in }

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
  static func page(article: Article, feedTitle: String?, body: String?, theme: AppTheme) -> String {
    let base = article.url.flatMap(URL.init(string:))
    // Tags that could change how the page loads; the CSP and disabled
    // JavaScript cover the rest.
    let raw = (body ?? article.contentHtml ?? article.summaryHtml ?? "")
      .replacing(/(?i)<\/?(meta|base|link|head|html|body)\b[^>]*>/, with: "")
    let content = proxyImages(raw, base: base)
    let date = article.published.formatted(date: .long, time: .shortened)
    let meta = [feedTitle, article.author, date].compactMap { $0 }.filter { !$0.isEmpty }
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
      :root { color-scheme: \(p.scheme.rawValue); --text: \(p.text); --muted: \(p.textMuted); --link: \(p.accentText); --rule: \(rule); --code: \(code); }
      html { -webkit-text-size-adjust: 100%; }
      body { margin: 0; padding: 12px 20px 120px; background: transparent; color: var(--text); font: 17px/1.65 \(font); overflow-wrap: anywhere; }
      header { margin: 8px 0 22px; }
      .meta { font: 600 13px/1.4 -apple-system, system-ui; color: var(--muted); margin: 0 0 8px; }
      h1.title { font: 700 26px/1.2 -apple-system, system-ui; letter-spacing: -0.01em; margin: 0; }
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
      </style></head>
      <body>
      <header>
      <p class="meta">\(meta)</p>
      <h1 class="title">\(heading)</h1>
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
