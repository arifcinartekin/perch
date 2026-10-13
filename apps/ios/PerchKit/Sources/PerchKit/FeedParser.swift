import Foundation

#if canImport(FoundationXML)
  import FoundationXML
#endif

/// A feed as published: RSS 2.0, RSS 1.0 (RDF), Atom or JSON Feed. The same
/// formats packages/core/src/parser reads, for reading on the phone without a
/// server.
public struct ParsedFeed: Sendable, Equatable {
  public var title: String
  public var siteUrl: String?
  public var items: [ParsedItem]
}

public struct ParsedItem: Sendable, Equatable {
  public var guid: String?
  public var url: String?
  public var title: String
  public var author: String?
  public var published: Date?
  public var summaryHtml: String?
  public var contentHtml: String?
  public var enclosures: [Enclosure]
}

public enum FeedParser {
  public enum Failure: Error, Equatable {
    /// Parsed, but not a feed (an HTML page, usually).
    case notAFeed
  }

  /// Parses feed bytes; relative links resolve against `url`.
  public static func parse(_ data: Data, url: URL? = nil) throws -> ParsedFeed {
    let head = String(decoding: data.prefix(512), as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines.union(.init(charactersIn: "\u{FEFF}")))
    var feed: ParsedFeed
    if head.hasPrefix("{") {
      feed = try json(data)
    } else {
      let delegate = XMLFeedDelegate()
      let parser = XMLParser(data: data)
      parser.shouldProcessNamespaces = true
      parser.delegate = delegate
      parser.parse()
      // A parse error after the items (a stray byte at the end) still leaves a
      // usable feed; only give up if nothing feed-like was seen.
      guard let parsed = delegate.result else { throw Failure.notAFeed }
      feed = parsed
    }
    if let url { feed = resolve(feed, against: url) }
    return feed
  }

  // MARK: JSON Feed

  private struct JSONFeed: Decodable {
    struct Author: Decodable { var name: String? }
    struct Attachment: Decodable {
      var url: String
      var mimeType: String?
      var sizeInBytes: Double?
    }
    struct Item: Decodable {
      var id: LossyString?
      var url: String?
      var externalUrl: String?
      var title: String?
      var contentHtml: String?
      var contentText: String?
      var summary: String?
      var image: String?
      var datePublished: String?
      var dateModified: String?
      var author: Author?
      var authors: [Author]?
      var attachments: [Attachment]?
    }
    var version: String?
    var title: String?
    var homePageUrl: String?
    var items: [Item]?
  }

  /// JSON Feed ids are strings, but some feeds send numbers.
  private struct LossyString: Decodable {
    var value: String
    init(from decoder: Decoder) throws {
      let c = try decoder.singleValueContainer()
      if let s = try? c.decode(String.self) {
        value = s
      } else {
        value = String(try c.decode(Double.self))
      }
    }
  }

  private static func json(_ data: Data) throws -> ParsedFeed {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    guard let feed = try? decoder.decode(JSONFeed.self, from: data),
      feed.version?.contains("jsonfeed.org") == true || feed.items != nil
    else { throw Failure.notAFeed }
    let items = (feed.items ?? []).map { item -> ParsedItem in
      var enclosures = (item.attachments ?? []).map {
        Enclosure(url: $0.url, type: $0.mimeType, length: $0.sizeInBytes)
      }
      if let image = item.image { enclosures.insert(Enclosure(url: image, type: "image/*"), at: 0) }
      let text = item.contentText.map { "<p>\(escape($0))</p>" }
      return ParsedItem(
        guid: item.id?.value, url: item.url ?? item.externalUrl,
        title: plainTitle(item.title ?? ""),
        author: item.authors?.first?.name ?? item.author?.name,
        published: FeedDates.pick([item.datePublished, item.dateModified]),
        summaryHtml: item.summary.map(escape), contentHtml: item.contentHtml ?? text,
        enclosures: enclosures)
    }
    return ParsedFeed(title: feed.title ?? "", siteUrl: feed.homePageUrl, items: items)
  }

  // MARK: Helpers

  /// Titles are text; some feeds put markup or entities in them anyway.
  static func plainTitle(_ s: String) -> String {
    guard s.contains("<") || s.contains("&") else {
      return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return HTMLText.plain(s, limit: 1000)
  }

  static func escape(_ s: String) -> String {
    s.replacing("&", with: "&amp;").replacing("<", with: "&lt;").replacing(">", with: "&gt;")
  }

  private static func resolve(_ feed: ParsedFeed, against base: URL) -> ParsedFeed {
    func absolute(_ s: String?) -> String? {
      guard let s, !s.isEmpty else { return nil }
      return URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines), relativeTo: base)?
        .absoluteString ?? s
    }
    var out = feed
    out.siteUrl = absolute(feed.siteUrl)
    out.items = feed.items.map { item in
      var i = item
      i.url = absolute(item.url)
      i.enclosures = item.enclosures.compactMap { e in
        absolute(e.url).map { Enclosure(url: $0, type: e.type, length: e.length) }
      }
      return i
    }
    return out
  }
}

// MARK: - XML

private enum NS {
  static let atom = "http://www.w3.org/2005/Atom"
  static let content = "http://purl.org/rss/1.0/modules/content/"
  static let dc = "http://purl.org/dc/elements/1.1/"
  static let media = "http://search.yahoo.com/mrss/"
  static let rss1 = "http://purl.org/rss/1.0/"
  static let rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
}

/// Walks RSS, RDF and Atom in one pass. Feed-level fields are taken only from
/// direct children of the channel/feed, so an `<image><title>` doesn't become
/// the feed's title.
private final class XMLFeedDelegate: NSObject, XMLParserDelegate {
  private enum Kind { case rss, atom }

  private var kind: Kind?
  private var stack: [(name: String, ns: String)] = []
  private var text = ""
  private var title: String?
  private var siteUrl: String?
  private var items: [ParsedItem] = []
  private var item: ParsedItem?
  /// The current item's date elements by name, first of each; picked as core does when it ends.
  private var dates: [String: String] = [:]
  /// Atom content type of the element being read (text, html, xhtml).
  private var textType = "text"
  private var xhtmlDepth = 0

  var result: ParsedFeed? {
    guard kind != nil else { return nil }
    return ParsedFeed(title: title ?? "", siteUrl: siteUrl, items: items)
  }

  func parser(
    _ parser: XMLParser, didStartElement name: String, namespaceURI ns: String?,
    qualifiedName: String?, attributes: [String: String] = [:]
  ) {
    let ns = ns ?? ""
    // Inside Atom xhtml content: keep the markup as it is.
    if xhtmlDepth > 0 {
      xhtmlDepth += 1
      text +=
        "<\(name)\(attributes.map { " \($0.key)=\"\(FeedParser.escape($0.value))\"" }.joined())>"
      return
    }
    stack.append((name, ns))
    text = ""

    switch (name, ns) {
    case ("rss", _), ("RDF", NS.rdf), ("channel", ""), ("channel", NS.rss1):
      if kind == nil { kind = .rss }
    case ("feed", NS.atom):
      if kind == nil { kind = .atom }
    case ("item", ""), ("item", NS.rss1), ("entry", NS.atom):
      item = ParsedItem(title: "", enclosures: [])
      dates = [:]
    default:
      break
    }

    if item != nil {
      switch (name, ns) {
      case ("link", NS.atom) where kind == .atom:
        let rel = attributes["rel"] ?? "alternate"
        if let href = attributes["href"] {
          if rel == "alternate", item?.url == nil {
            item?.url = href
          } else if rel == "enclosure" {
            item?.enclosures.append(
              Enclosure(
                url: href, type: attributes["type"],
                length: attributes["length"].flatMap(Double.init)))
          }
        }
      case ("enclosure", ""):
        if let url = attributes["url"] {
          item?.enclosures.append(
            Enclosure(
              url: url, type: attributes["type"], length: attributes["length"].flatMap(Double.init))
          )
        }
      case ("content", NS.media), ("thumbnail", NS.media):
        if let url = attributes["url"] {
          let medium = attributes["medium"]
          let type =
            attributes["type"] ?? (name == "thumbnail" || medium == "image" ? "image/*" : nil)
          if !(item?.enclosures.contains { $0.url == url } ?? false) {
            item?.enclosures.append(Enclosure(url: url, type: type))
          }
        }
      case ("content", NS.atom), ("summary", NS.atom), ("title", NS.atom):
        textType = attributes["type"] ?? "text"
        if textType == "xhtml" { xhtmlDepth = 1 }
      default:
        break
      }
    } else if kind == .atom, name == "link", ns == NS.atom, parent?.name == "feed" {
      let rel = attributes["rel"] ?? "alternate"
      if rel == "alternate", siteUrl == nil { siteUrl = attributes["href"] }
    } else if name == "title", ns == NS.atom {
      textType = attributes["type"] ?? "text"
    }
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    text += xhtmlDepth > 0 ? FeedParser.escape(string) : string
  }

  func parser(_ parser: XMLParser, foundCDATA data: Data) {
    text += String(decoding: data, as: UTF8.self)
  }

  func parser(
    _ parser: XMLParser, didEndElement name: String, namespaceURI ns: String?,
    qualifiedName: String?
  ) {
    let ns = ns ?? ""
    if xhtmlDepth > 1 {
      xhtmlDepth -= 1
      text += "</\(name)>"
      return
    }
    xhtmlDepth = 0
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    defer {
      if !stack.isEmpty { stack.removeLast() }
      text = ""
    }

    if var current = item {
      switch (name, ns) {
      case ("item", ""), ("item", NS.rss1), ("entry", NS.atom):
        // The candidates and their order in core/parser/rss.ts and atom.ts.
        let order =
          name == "entry"
          ? ["atom:published", "atom:updated", "dc:date"]
          : ["pubDate", "dc:date", "published", "date"]
        current.published = FeedDates.pick(order.map { dates[$0] })
        items.append(current)
        item = nil
        return
      case ("title", _) where ns != NS.media:
        current.title = FeedParser.plainTitle(value)
      case ("link", ""), ("link", NS.rss1):
        if current.url == nil, !value.isEmpty { current.url = value }
      case ("guid", ""):
        current.guid = value.isEmpty ? nil : value
      case ("id", NS.atom):
        current.guid = value.isEmpty ? nil : value
      case ("date", NS.dc):
        if dates["dc:date"] == nil { dates["dc:date"] = value }
      case ("pubDate", ""), ("pubDate", NS.rss1), ("published", ""), ("published", NS.rss1),
        ("date", ""), ("date", NS.rss1):
        if dates[name] == nil { dates[name] = value }
      case ("published", NS.atom), ("updated", NS.atom):
        if dates["atom:\(name)"] == nil { dates["atom:\(name)"] = value }
      case ("creator", NS.dc), ("author", ""):
        if current.author == nil, !value.isEmpty { current.author = value }
      case ("name", NS.atom) where parent?.name == "author":
        if current.author == nil, !value.isEmpty { current.author = value }
      case ("description", ""), ("description", NS.rss1):
        current.summaryHtml = value.isEmpty ? nil : value
      case ("encoded", NS.content):
        current.contentHtml = value.isEmpty ? nil : value
      case ("summary", NS.atom):
        current.summaryHtml = html(value)
      case ("content", NS.atom):
        current.contentHtml = html(value)
      default:
        break
      }
      item = current
      return
    }

    // Feed-level: only direct children of channel / feed.
    let parentName = parent?.name
    switch (name, ns) {
    case ("title", _) where parentName == "channel" || parentName == "feed":
      if title == nil { title = FeedParser.plainTitle(value) }
    case ("link", ""), ("link", NS.rss1):
      if parentName == "channel", siteUrl == nil, !value.isEmpty { siteUrl = value }
    default:
      break
    }
  }

  private var parent: (name: String, ns: String)? {
    stack.count >= 2 ? stack[stack.count - 2] : nil
  }

  /// Atom text constructs: plain text becomes escaped HTML.
  private func html(_ value: String) -> String? {
    if value.isEmpty { return nil }
    return textType == "text" ? "<p>\(FeedParser.escape(value))</p>" : value
  }
}

// MARK: - Dates

/// RFC 822 (RSS) and ISO 8601 (Atom, JSON Feed, Dublin Core) dates, with the
/// usual variations found in the wild.
///
/// parseDate in core/parser/dates.ts, rule for rule: an item keyed on its date
/// must get the same id on every device. packages/core/tests/fixtures/dates.json
/// pins the three.
public enum FeedDates {
  /// resolvePublishedAt in core/parser/dates.ts: the first candidate that
  /// parses and isn't more than a day in the future, or nil (undated).
  public static func pick(_ candidates: [String?], now: Date = .now) -> Date? {
    let maxFuture = now.addingTimeInterval(24 * 60 * 60)
    for c in candidates {
      if let d = parse(c), d <= maxFuture { return d }
    }
    return nil
  }

  public static func parse(_ raw: String?) -> Date? {
    parseMillis(raw).map { Date(timeIntervalSince1970: Double($0) / 1000) }
  }

  private static let months = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  ]

  /// RFC 822 zone names, in hours from UTC. Any other name counts as UTC.
  private static let zones: [String: Int] = [
    "GMT": 0, "UT": 0, "UTC": 0, "Z": 0, "EST": -5, "EDT": -4,
    "CST": -6, "CDT": -5, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7,
  ]

  /// Epoch milliseconds, or nil when the string isn't a date these rules read.
  static func parseMillis(_ raw: String?) -> Int64? {
    guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    let s = trimmed.replacing(/\s+/, with: " ")
    guard !s.isEmpty else { return nil }

    if let m = s.wholeMatch(
      of: /(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*([Zz]|[+-]\d{2}:?\d{2})?/)
    {
      let ms = m.7.map { Int(String(($0 + "00").prefix(3)))! } ?? 0
      return epoch(
        year: Int(m.1)!, month: Int(m.2)!, day: Int(m.3)!, hour: int(m.4), minute: int(m.5),
        second: int(m.6), ms: ms, offset: zoneOffset(m.8.map(String.init)))
    }

    if let m = s.wholeMatch(
      of: /(?:[A-Za-z]+,?\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([A-Za-z]+|[+-]\d{2}:?\d{2}))?/)
    {
      guard let index = months.firstIndex(of: m.2.prefix(3).lowercased()) else { return nil }
      var year = Int(m.3)!
      if m.3.count == 2 { year += year < 50 ? 2000 : 1900 }
      return epoch(
        year: year, month: index + 1, day: Int(m.1)!, hour: int(m.4), minute: int(m.5),
        second: int(m.6), ms: 0, offset: zoneOffset(m.7.map(String.init)))
    }

    return nil
  }

  private static func int(_ s: Substring?) -> Int { s.flatMap { Int($0) } ?? 0 }

  /// Minutes east of UTC; no zone or an unknown name is UTC, a bad offset nil.
  private static func zoneOffset(_ zone: String?) -> Int? {
    guard let zone, !zone.isEmpty else { return 0 }
    if let hours = zones[zone.uppercased()] { return hours * 60 }
    guard let m = zone.wholeMatch(of: /([+-])(\d{2}):?(\d{2})/) else { return 0 }
    let hours = Int(m.2)!
    let minutes = Int(m.3)!
    if hours > 23 || minutes > 59 { return nil }
    return (m.1 == "-" ? -1 : 1) * (hours * 60 + minutes)
  }

  /// Days from 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's days_from_civil).
  private static func days(year: Int, month: Int, day: Int) -> Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
  }

  private static func daysInMonth(year: Int, month: Int) -> Int {
    days(year: month == 12 ? year + 1 : year, month: month == 12 ? 1 : month + 1, day: 1)
      - days(year: year, month: month, day: 1)
  }

  private static func epoch(
    year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, ms: Int, offset: Int?
  ) -> Int64? {
    guard let offset, (1...12).contains(month) else { return nil }
    guard day >= 1, day <= daysInMonth(year: year, month: month) else { return nil }
    guard hour <= 23, minute <= 59, second <= 59 else { return nil }
    let seconds = Int64(days(year: year, month: month, day: day)) * 86400
      + Int64(hour * 3600 + minute * 60 + second)
    return seconds * 1000 + Int64(ms) - Int64(offset) * 60_000
  }
}
