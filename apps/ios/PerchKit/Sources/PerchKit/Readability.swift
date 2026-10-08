import Foundation

/// The readable part of a web page, for "full text" without a server. A
/// small heuristic, not Mozilla's Readability: the page's `<article>` or
/// `<main>` when it has enough text, else the page's paragraphs in order.
public enum Readability {
  public static func extract(_ html: String) -> FullText? {
    let title = meta(html, "og:title") ?? pageTitle(html)
    let byline = meta(html, "author")
    var doc = html
    if let body = doc.firstMatch(of: /(?is)<body\b[^>]*>(.*)<\/body>/) { doc = String(body.1) }
    doc = HTMLText.sanitize(doc)
    // Page furniture.
    doc = doc.replacing(
      /(?is)<(nav|header|footer|aside|form|button|select|svg|dialog|menu)\b.*?<\/\1\s*>/, with: "")

    let candidates =
      doc.matches(of: /(?is)<article\b[^>]*>(.*?)<\/article\s*>/).map { String($0.1) }
      + doc.matches(of: /(?is)<main\b[^>]*>(.*?)<\/main\s*>/).map { String($0.1) }
    let best = candidates.max { textLength($0) < textLength($1) }
    var content: String
    if let best, textLength(best) >= 400 {
      content = best
    } else {
      content =
        doc.matches(
          of: /(?is)<(p|h2|h3|h4|blockquote|pre|ul|ol|figure)\b[^>]*>.*?<\/\1\s*>/
        )
        .map { String($0.0) }
        .filter { $0.hasPrefix("<p") ? textLength($0) >= 40 : true }
        .joined(separator: "\n")
    }
    content = lazyImages(content)
    guard textLength(content) >= 200 else { return nil }
    return FullText(html: content, title: title, byline: byline)
  }

  private static func textLength(_ html: String) -> Int {
    HTMLText.plain(html, limit: .max).count
  }

  /// `<img data-src>` and friends, which only load with the page's scripts.
  private static func lazyImages(_ html: String) -> String {
    html.replacing(/(?i)<img\b[^>]*>/) { match in
      let tag = String(match.0)
      guard
        let lazy = tag.firstMatch(of: /(?i)\sdata-(?:src|original|lazy-src)\s*=\s*["']([^"']+)["']/)
      else { return tag }
      let stripped = tag.replacing(/(?i)\ssrc\s*=\s*["'][^"']*["']/, with: "")
      return stripped.replacing(/(?i)^<img/, with: "<img src=\"\(lazy.1)\"")
    }
  }

  private static func meta(_ html: String, _ name: String) -> String? {
    for tag in html.prefix(100_000).matches(of: /(?i)<meta\s[^>]*>/) {
      let t = String(tag.0)
      guard
        let key = t.firstMatch(of: /(?i)\s(?:property|name)\s*=\s*["']([^"']+)["']/),
        key.1.lowercased() == name,
        let value = t.firstMatch(of: /(?i)\scontent\s*=\s*["']([^"']*)["']/)
      else { continue }
      let text = HTMLText.decodeEntities(String(value.1)).trimmingCharacters(in: .whitespaces)
      if !text.isEmpty { return text }
    }
    return nil
  }

  private static func pageTitle(_ html: String) -> String? {
    guard let m = html.firstMatch(of: /(?is)<title\b[^>]*>(.*?)<\/title>/) else { return nil }
    let text = HTMLText.plain(String(m.1), limit: 300)
    return text.isEmpty ? nil : text
  }
}

extension HTMLText {
  /// Feed or page HTML without scripts, styles, frames and event handlers.
  /// The reader's CSP and disabled JavaScript are the real protection; this
  /// keeps stored copies tidy.
  public static func sanitize(_ html: String) -> String {
    var s = html
    s = s.replacing(
      /(?is)<(script|style|noscript|template|iframe|object|embed|frameset)\b.*?<\/\1\s*>/,
      with: "")
    s = s.replacing(/(?i)<\/?(script|style|iframe|object|embed|link|meta|base)\b[^>]*>/, with: "")
    s = s.replacing(/(?i)\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/, with: "")
    s = s.replacing(/(?i)(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/) { m in "\(m.1)=\"#\"" }
    return s
  }
}
