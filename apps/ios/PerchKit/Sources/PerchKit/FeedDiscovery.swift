import Foundation

/// Ids and feed discovery the way packages/core does them, so a feed added on
/// the phone gets the same id it would get on a Perch Server.
public enum FeedIDs {
  /// FNV-1a, 32-bit, over UTF-16 code units, as hex (fnv1aHex in core/hash.ts).
  public static func fnv1aHex(_ input: String) -> String {
    var h: UInt32 = 0x811c_9dc5
    for unit in input.utf16 {
      h ^= UInt32(unit)
      h = h &* 0x0100_0193
    }
    let hex = String(h, radix: 16)
    return String(repeating: "0", count: max(0, 8 - hex.count)) + hex
  }

  /// idFrom in core/hash.ts: the parts joined with NUL.
  public static func idFrom(_ parts: String...) -> String {
    fnv1aHex(parts.joined(separator: "\u{0}"))
  }

  /// feedIdFor in core/feeds.ts.
  public static func feed(_ url: String) -> String {
    idFrom("feed", normalizeFeedURL(url))
  }

  /// toArticle in core/parser/normalize.ts: the guid, else the link, else
  /// title and date.
  public static func article(feedId: String, _ item: ParsedItem, publishedAt: Double) -> String {
    let identity =
      nonEmpty(item.guid) ?? nonEmpty(item.url)
      ?? "\(item.title) \(Int(publishedAt))"
    return idFrom(feedId, identity)
  }

  /// normalizeFeedUrl in core/url.ts: no fragment, lowercase host, no
  /// trailing slash, no default port.
  public static func normalizeFeedURL(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard var c = URLComponents(string: trimmed), let scheme = c.scheme?.lowercased(),
      let host = c.host
    else { return trimmed }
    c.scheme = scheme
    c.fragment = nil
    c.host = host.lowercased()
    if c.path.count > 1, c.path.hasSuffix("/") {
      c.path = String(c.path.trimmingSuffix("/"))
    }
    if c.path.isEmpty { c.path = "/" }
    if (scheme == "http" && c.port == 80) || (scheme == "https" && c.port == 443) { c.port = nil }
    return c.string ?? trimmed
  }

  private static func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
  }
}

extension String {
  fileprivate func trimmingSuffix(_ suffix: Character) -> Substring {
    var s = Substring(self)
    while s.count > 1, s.last == suffix { s = s.dropLast() }
    return s
  }
}

public enum FeedDiscovery {
  /// Feed links a page advertises (feedLinksFromHtml in core/discovery/html.ts).
  public static func links(in html: String, pageURL: URL) -> [URL] {
    let head = String(html.prefix(200_000))
    var base = pageURL
    if let tag = head.firstMatch(of: /(?i)<base\s[^>]*>/),
      let href = attributes(String(tag.0))["href"], let url = URL(string: href, relativeTo: pageURL)
    {
      base = url.absoluteURL
    }
    let types: Set<String> = [
      "application/rss+xml", "application/atom+xml", "application/feed+json", "text/xml",
      "application/xml",
    ]
    var out: [URL] = []
    for match in head.matches(of: /(?i)<link\s[^>]*>/) {
      let a = attributes(String(match.0))
      let rel = (a["rel"] ?? "").lowercased().split(separator: " ")
      let type = (a["type"] ?? "").lowercased().trimmingCharacters(in: .whitespaces)
      let feedRel = rel.contains("feed")
      guard rel.contains("alternate") || feedRel else { continue }
      guard types.contains(type) || feedRel else { continue }
      guard let href = a["href"], let url = URL(string: href, relativeTo: base)?.absoluteURL,
        url.scheme == "http" || url.scheme == "https", !out.contains(url)
      else { continue }
      out.append(url)
    }
    return out
  }

  /// Usual feed locations to try when a page names none (core/discovery/candidates.ts).
  public static func guesses(for pageURL: URL) -> [URL] {
    guard var origin = URLComponents(url: pageURL, resolvingAgainstBaseURL: true) else {
      return []
    }
    origin.path = ""
    origin.query = nil
    origin.fragment = nil
    guard let root = origin.url else { return [] }
    return [
      "/feed", "/rss", "/rss.xml", "/atom.xml", "/index.xml", "/feed.xml", "/atom", "/?feed=rss2",
      "/feeds/posts/default", "/blog/feed", "/blog/rss.xml",
    ].compactMap { URL(string: $0, relativeTo: root)?.absoluteURL }
  }

  private static func attributes(_ tag: String) -> [String: String] {
    var out: [String: String] = [:]
    for m in tag.matches(of: /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/) {
      let raw: Substring = m.2 ?? m.3 ?? m.4 ?? ""
      let value = String(raw)
      out[m.1.lowercased()] = HTMLText.decodeEntities(value)
    }
    return out
  }
}

/// OPML subscriptions lists (core/opml.ts): outlines with an xmlUrl, grouped
/// by their parent outline's title.
public enum OPML {
  public struct Outline: Sendable, Equatable {
    public var url: String
    public var title: String?
    public var category: String?
  }

  public static func parse(_ data: Data) throws -> [Outline] {
    let delegate = Delegate()
    let parser = XMLParser(data: data)
    parser.delegate = delegate
    guard parser.parse() || !delegate.outlines.isEmpty, delegate.sawOPML else {
      throw FeedParser.Failure.notAFeed
    }
    return delegate.outlines
  }

  public static func build(_ library: Library, title: String = "Perch subscriptions") -> Data {
    func esc(_ s: String) -> String {
      FeedParser.escape(s).replacing("\"", with: "&quot;")
    }
    let byCategory = Dictionary(grouping: library.feeds, by: \.categoryId)
    var lines = [
      #"<?xml version="1.0" encoding="UTF-8"?>"#, #"<opml version="2.0">"#,
      "  <head><title>\(esc(title))</title></head>", "  <body>",
    ]
    func feedLine(_ f: Feed, indent: String) -> String {
      var s = "\(indent)<outline type=\"rss\" text=\"\(esc(f.displayTitle))\" "
      s += "title=\"\(esc(f.displayTitle))\" xmlUrl=\"\(esc(f.url))\""
      if let site = f.siteUrl { s += " htmlUrl=\"\(esc(site))\"" }
      return s + "/>"
    }
    for f in byCategory[uncategorizedId] ?? [] { lines.append(feedLine(f, indent: "    ")) }
    for c in library.categories.sorted(by: { $0.order < $1.order }) where c.id != uncategorizedId {
      let feeds = byCategory[c.id] ?? []
      if feeds.isEmpty { continue }
      lines.append("    <outline text=\"\(esc(c.name))\" title=\"\(esc(c.name))\">")
      for f in feeds { lines.append(feedLine(f, indent: "      ")) }
      lines.append("    </outline>")
    }
    lines += ["  </body>", "</opml>", ""]
    return Data(lines.joined(separator: "\n").utf8)
  }

  private final class Delegate: NSObject, XMLParserDelegate {
    var outlines: [Outline] = []
    var sawOPML = false
    /// Titles of the open outlines that aren't feeds.
    private var groups: [String?] = []

    func parser(
      _ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
      qualifiedName: String?, attributes a: [String: String] = [:]
    ) {
      if name.lowercased() == "opml" { sawOPML = true }
      guard name.lowercased() == "outline" else { return }
      let title = (a["title"] ?? a["text"])?.trimmingCharacters(in: .whitespacesAndNewlines)
      if let url = a["xmlUrl"] ?? a["xmlurl"], !url.isEmpty {
        outlines.append(
          Outline(url: url, title: title, category: groups.compactMap { $0 }.last))
        groups.append(nil)
      } else {
        groups.append(title?.isEmpty == false ? title : nil)
      }
    }

    func parser(
      _ parser: XMLParser, didEndElement name: String, namespaceURI: String?,
      qualifiedName: String?
    ) {
      if name.lowercased() == "outline", !groups.isEmpty { groups.removeLast() }
    }
  }
}
