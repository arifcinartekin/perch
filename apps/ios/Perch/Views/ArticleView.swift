import PerchKit
import SafariServices
import SwiftUI
import WebKit

/// One article. Opening it marks it read; the bottom bar stars it, keeps it
/// unread, swaps in the full text from the site, shares or opens the original.
struct ArticleView: View {
  @Environment(Reader.self) private var reader
  let article: Article

  @State private var fullText: FullText?
  @State private var showFullText = false
  @State private var loadingFullText = false
  @State private var fullTextError: String?
  @State private var safari: SafariTarget?

  private var current: Article { reader.current(article) }
  private var link: URL? { article.url.flatMap(URL.init(string:)) }

  var body: some View {
    ArticleWebView(
      html: ArticleHTML.page(
        article: article,
        feedTitle: reader.feed(article.feedId)?.displayTitle,
        body: showFullText ? fullText?.html : nil,
        serif: reader.settings.readingFont == .serif),
      baseURL: link,
      onLink: { url in
        if url.scheme == "http" || url.scheme == "https" { safari = SafariTarget(url: url) }
      }
    )
    .ignoresSafeArea(edges: .bottom)
    .background { Backdrop() }
    .navigationTitle(reader.feed(article.feedId)?.displayTitle ?? "")
    .toolbarTitleDisplayMode(.inline)
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
      }
    }
    .alert("Couldn't get the full text", isPresented: hasFullTextError) {
      Button("OK") { fullTextError = nil }
    } message: {
      Text(fullTextError ?? "")
    }
    .fullScreenCover(item: $safari) { target in
      SafariView(url: target.url).ignoresSafeArea()
    }
    .task { await reader.setRead(article, true) }
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
        fullText = try await reader.client.fullText(article.ref)
        showFullText = true
      } catch {
        fullTextError = error.localizedDescription
      }
    }
  }

  private var hasFullTextError: Binding<Bool> {
    Binding(get: { fullTextError != nil }, set: { if !$0 { fullTextError = nil } })
  }
}

/// A page to show in Safari, as a sheet item.
private struct SafariTarget: Identifiable {
  let url: URL
  var id: String { url.absoluteString }
}

// MARK: - Web view

/// Renders article HTML with JavaScript off and a CSP that blocks scripts,
/// frames, forms and plugins: feed HTML is untrusted. Images and media load.
/// Link taps come back through `onLink` instead of navigating.
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
    context.coordinator.loaded = html
    context.coordinator.expectingLoad = true
    view.loadHTMLString(html, baseURL: baseURL)
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var loaded: String?
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
    let vc = SFSafariViewController(url: url)
    return vc
  }

  func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

// MARK: - HTML

enum ArticleHTML {
  static func page(article: Article, feedTitle: String?, body: String?, serif: Bool) -> String {
    // Tags that could change how the page loads; the CSP and disabled
    // JavaScript cover the rest.
    let content = (body ?? article.contentHtml ?? article.summaryHtml ?? "")
      .replacing(/(?i)<\/?(meta|base|link|head|html|body)\b[^>]*>/, with: "")
    let date = article.published.formatted(date: .long, time: .shortened)
    let meta = [feedTitle, article.author, date].compactMap { $0 }.filter { !$0.isEmpty }
      .map(escape).joined(separator: " · ")
    let font =
      serif
      ? "ui-serif, 'New York', Georgia, serif"
      : "-apple-system, system-ui, 'Helvetica Neue', sans-serif"

    return """
      <!doctype html>
      <html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; media-src *; style-src 'unsafe-inline'; font-src *">
      <style>
      :root { color-scheme: light dark; --text: #12151c; --muted: #555a66; --link: #b35512; --rule: rgba(18,21,28,.12); --code: rgba(18,21,28,.06); }
      @media (prefers-color-scheme: dark) { :root { --text: #f4f1ea; --muted: #b8b4aa; --link: #ff7a1a; --rule: rgba(244,241,234,.14); --code: rgba(244,241,234,.08); } }
      html { -webkit-text-size-adjust: 100%; }
      body { margin: 0; padding: 12px 20px 120px; background: transparent; color: var(--text); font: 17px/1.65 \(font); overflow-wrap: anywhere; }
      header { margin: 8px 0 22px; }
      .meta { font: 600 13px/1.4 -apple-system, system-ui; color: var(--muted); margin: 0 0 8px; }
      h1.title { font: 700 26px/1.2 -apple-system, system-ui; letter-spacing: -0.01em; margin: 0; }
      h1.title a { color: inherit; text-decoration: none; }
      a { color: var(--link); text-underline-offset: 2px; }
      img, video, figure, iframe, svg, table { max-width: 100%; height: auto; }
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
      <h1 class="title">\(article.url.map { "<a href=\"\(escape($0))\">\(escape(article.displayTitle))</a>" } ?? escape(article.displayTitle))</h1>
      </header>
      <article>\(content)</article>
      </body></html>
      """
  }

  static func escape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }
}
