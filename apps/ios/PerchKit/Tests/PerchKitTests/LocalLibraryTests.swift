import Foundation
import Testing

@testable import PerchKit

// Reading without a server: feed parsing, ids that match packages/core, OPML,
// and the on-device library against stubbed HTTP.

@Suite struct FeedParserTests {
  @Test func rss() throws {
    let xml = """
      <?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
        xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <title>Field &amp; Notes</title>
        <link>https://example.com/</link>
        <image><title>Logo title</title><url>https://example.com/logo.png</url></image>
        <item>
          <title>First &lt;b&gt;post&lt;/b&gt;</title>
          <link>/posts/1</link>
          <guid isPermaLink="false">post-1</guid>
          <pubDate>Tue, 10 Jun 2025 04:00:00 GMT</pubDate>
          <dc:creator>Ada</dc:creator>
          <description>Short &lt;i&gt;summary&lt;/i&gt;</description>
          <content:encoded><![CDATA[<p>Full <b>text</b></p>]]></content:encoded>
          <enclosure url="https://example.com/a.mp3" type="audio/mpeg" length="123"/>
          <media:thumbnail url="https://example.com/t.jpg"/>
        </item>
        <item><title>Second</title><link>https://example.com/2</link>
          <pubDate>Wed, 11 Jun 2025 09:30:00 +0200</pubDate></item>
      </channel></rss>
      """
    let feed = try FeedParser.parse(Data(xml.utf8), url: URL(string: "https://example.com/feed"))
    #expect(feed.title == "Field & Notes")
    #expect(feed.siteUrl == "https://example.com/")
    #expect(feed.items.count == 2)
    let first = feed.items[0]
    #expect(first.title == "First post")
    #expect(first.url == "https://example.com/posts/1")
    #expect(first.guid == "post-1")
    #expect(first.author == "Ada")
    #expect(first.summaryHtml == "Short <i>summary</i>")
    #expect(first.contentHtml == "<p>Full <b>text</b></p>")
    #expect(
      first.enclosures.map(\.url) == ["https://example.com/a.mp3", "https://example.com/t.jpg"])
    #expect(first.published == Date(timeIntervalSince1970: 1_749_528_000))
    #expect(feed.items[1].published == Date(timeIntervalSince1970: 1_749_627_000))
  }

  @Test func atom() throws {
    let xml = """
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title type="text">Atom Blog</title>
        <link rel="self" href="https://a.example/feed.xml"/>
        <link href="https://a.example/"/>
        <entry>
          <title type="html">Tom &amp;amp; Jerry</title>
          <id>tag:a.example,2025:1</id>
          <link rel="alternate" href="https://a.example/1"/>
          <updated>2025-06-10T04:00:00Z</updated>
          <author><name>Bea</name></author>
          <summary>Plain &lt; text</summary>
          <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hi <em>there</em></p></div></content>
        </entry>
      </feed>
      """
    let feed = try FeedParser.parse(Data(xml.utf8))
    #expect(feed.title == "Atom Blog")
    #expect(feed.siteUrl == "https://a.example/")
    let e = try #require(feed.items.first)
    #expect(e.title == "Tom & Jerry")
    #expect(e.guid == "tag:a.example,2025:1")
    #expect(e.url == "https://a.example/1")
    #expect(e.author == "Bea")
    #expect(e.published == Date(timeIntervalSince1970: 1_749_528_000))
    #expect(e.summaryHtml == "<p>Plain &lt; text</p>")
    #expect(e.contentHtml?.contains("<p>Hi <em>there</em></p>") == true)
  }

  @Test func rdf() throws {
    let xml = """
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>RDF Site</title><link>https://r.example/</link></channel>
        <item><title>One</title><link>https://r.example/1</link><dc:date>2025-06-10</dc:date></item>
      </rdf:RDF>
      """
    let feed = try FeedParser.parse(Data(xml.utf8))
    #expect(feed.title == "RDF Site")
    #expect(feed.items.first?.url == "https://r.example/1")
    #expect(feed.items.first?.published == Date(timeIntervalSince1970: 1_749_513_600))
  }

  @Test func jsonFeed() throws {
    let json = """
      {"version":"https://jsonfeed.org/version/1.1","title":"JSON Blog",
       "home_page_url":"https://j.example/",
       "items":[{"id":1,"url":"https://j.example/1","title":"Hello",
         "content_text":"a < b","date_published":"2025-06-10T06:00:00+02:00",
         "authors":[{"name":"Cy"}],"image":"https://j.example/i.png"}]}
      """
    let feed = try FeedParser.parse(Data(json.utf8))
    #expect(feed.title == "JSON Blog")
    let item = try #require(feed.items.first)
    #expect(item.guid == "1.0")
    #expect(item.contentHtml == "<p>a &lt; b</p>")
    #expect(item.author == "Cy")
    #expect(item.published == Date(timeIntervalSince1970: 1_749_528_000))
    #expect(item.enclosures.first?.url == "https://j.example/i.png")
  }

  @Test func htmlIsNotAFeed() {
    #expect(throws: FeedParser.Failure.notAFeed) {
      try FeedParser.parse(Data("<!doctype html><html><body>Hi</body></html>".utf8))
    }
  }

  @Test func dates() {
    let expected = Date(timeIntervalSince1970: 1_749_528_000)
    for s in [
      "Tue, 10 Jun 2025 04:00:00 GMT", "Tue, 10 Jun 2025 04:00:00 +0000", "10 Jun 2025 04:00 GMT",
      "Tue, 10 Jun 2025 00:00:00 EDT", "2025-06-10T04:00:00Z", "2025-06-10T04:00:00.000Z",
      "2025-06-10T06:00:00+02:00", "2025-06-10T06:00:00+0200", "2025-06-10 04:00:00",
      "2025-06-10T04:00Z",
    ] {
      #expect(FeedDates.parse(s) == expected, "\(s)")
    }
    #expect(FeedDates.parse("soon") == nil)
  }
}

@Suite struct FeedIDTests {
  // From packages/core: feedIdFor, normalizeFeedUrl and idFrom.
  @Test func matchCore() {
    #expect(FeedIDs.normalizeFeedURL("https://Example.com/feed/") == "https://example.com/feed")
    #expect(FeedIDs.feed("https://Example.com/feed/") == "41788b4e")
    #expect(FeedIDs.normalizeFeedURL("https://example.com") == "https://example.com/")
    #expect(FeedIDs.feed("https://example.com") == "06eed736")
    #expect(FeedIDs.feed("http://example.com:80/a/b?x=1#frag") == "4aecf186")
    #expect(
      FeedIDs.idFrom(FeedIDs.feed("https://example.com/feed"), "tag:example.com,2024:1")
        == "42ddfaf8")
    #expect(FeedIDs.idFrom("Türkçe başlık 🐦") == "9549c7db")
    #expect(FeedIDs.idFrom("Türkçe", "başlık 🐦") == "b1ac9bfb")
  }
}

@Suite struct DiscoveryAndOPMLTests {
  @Test func linksInAPage() {
    let html = """
      <html><head>
      <link rel="stylesheet" href="/s.css">
      <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://other.example/atom">
      <link rel="alternate" type="text/html" href="/fr">
      </head></html>
      """
    let links = FeedDiscovery.links(in: html, pageURL: URL(string: "https://site.example/blog/")!)
    #expect(
      links.map(\.absoluteString) == [
        "https://site.example/feed.xml", "https://other.example/atom",
      ])
  }

  @Test func opmlRoundTrip() throws {
    let opml = """
      <?xml version="1.0"?><opml version="1.0"><body>
        <outline text="Loose" xmlUrl="https://l.example/feed"/>
        <outline text="Tech">
          <outline text="A &amp; B" type="rss" xmlUrl="https://a.example/rss"/>
        </outline>
      </body></opml>
      """
    let outlines = try OPML.parse(Data(opml.utf8))
    #expect(outlines.count == 2)
    #expect(outlines[0].category == nil)
    #expect(
      outlines[1] == OPML.Outline(url: "https://a.example/rss", title: "A & B", category: "Tech"))

    let library = Library(
      feeds: [
        Feed(
          id: "1", url: "https://a.example/rss", title: "A & B", categoryId: "c", addedAt: 0),
        Feed(
          id: "2", url: "https://l.example/feed", title: "Loose", categoryId: uncategorizedId,
          addedAt: 0),
      ],
      categories: [Category(id: "c", name: "Tech", order: 10)])
    let again = try OPML.parse(OPML.build(library))
    #expect(Set(again.map(\.url)) == ["https://a.example/rss", "https://l.example/feed"])
    #expect(again.first { $0.url == "https://a.example/rss" }?.category == "Tech")
  }

  @Test func readability() throws {
    let page = """
      <html><head><title>Page</title><meta property="og:title" content="The &amp; Story">
      <meta name="author" content="Dee"></head><body>
      <nav><p>Home About Contact and many other links that are not the article at all</p></nav>
      <article><h1>The Story</h1>
      <p>\(String(repeating: "Words in the article body. ", count: 30))</p>
      <script>alert(1)</script>
      <img data-src="/big.jpg" src="data:image/gif;base64,R0lGOD" onerror="x()">
      </article><footer>© 2025</footer></body></html>
      """
    let text = try #require(Readability.extract(page))
    #expect(text.title == "The & Story")
    #expect(text.byline == "Dee")
    #expect(text.html.contains("Words in the article body."))
    #expect(!text.html.contains("Home About"))
    #expect(!text.html.contains("alert"))
    #expect(!text.html.contains("onerror"))
    #expect(text.html.contains("<img src=\"/big.jpg\""))
  }
}

// MARK: - The on-device library

/// Serves canned responses by URL.
final class StubProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var responses: [String: (Int, String, [String: String])] = [:]
  nonisolated(unsafe) static var requests: [URLRequest] = []

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.append(request)
    let url = request.url!.absoluteString
    let (status, body, headers) = Self.responses[url] ?? (404, "", [:])
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

@Suite(.serialized) struct LocalBackendTests {
  private func backend() throws -> LocalBackend {
    let dir = FileManager.default.temporaryDirectory.appending(path: "perch-local-\(UUID())")
    let store = try OfflineStore(url: dir.appending(path: "library.sqlite"))
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    return LocalBackend(store: store, configuration: config)
  }

  private func rss(_ items: [(String, String)]) -> String {
    let recent = Date.now.addingTimeInterval(-3600)
    let date = recent.formatted(.iso8601)
    return """
      <rss version="2.0"><channel><title>Stub Blog</title><link>https://stub.example/</link>
      \(items.map { "<item><title>\($0.1)</title><guid>\($0.0)</guid><link>https://stub.example/\($0.0)</link><pubDate>\(date)</pubDate></item>" }.joined())
      <item><title>Too old</title><guid>old</guid><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate></item>
      </channel></rss>
      """
  }

  @Test func addFromASitePageThenRefresh() async throws {
    StubProtocol.requests = []
    StubProtocol.responses = [
      "https://stub.example/": (
        200,
        #"<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>"#,
        ["Content-Type": "text/html"]
      ),
      "https://stub.example/rss": (200, rss([("a", "One"), ("b", "Two")]), ["ETag": "\"v1\""]),
    ]
    let local = try backend()
    let added = try await local.addFeed(url: "stub.example", categoryId: nil)
    #expect(added.created)
    #expect(added.feed.url == "https://stub.example/rss")
    #expect(added.feed.id == FeedIDs.feed("https://stub.example/rss"))
    #expect(added.feed.title == "Stub Blog")
    #expect(added.feed.categoryId == uncategorizedId)

    var counts = try await local.counts()
    #expect(counts.unread[added.feed.id] == 2)  // "Too old" is left out.

    let page = try await local.articles(.init(unreadOnly: true), before: nil, limit: 50)
    #expect(Set(page.items.map(\.title)) == ["One", "Two"])
    let one = try #require(page.items.first { $0.title == "One" })
    try await local.setState([one.ref], read: true, starred: true)

    // A new item arrives; the read one stays read; the ETag is sent back.
    StubProtocol.responses["https://stub.example/rss"] = (
      200, rss([("a", "One"), ("b", "Two"), ("c", "Three")]), [:]
    )
    try await local.refresh(feeds: nil)
    let sent = StubProtocol.requests.last { $0.url?.path() == "/rss" }
    #expect(sent?.value(forHTTPHeaderField: "If-None-Match") == "\"v1\"")
    counts = try await local.counts()
    #expect(counts.unread[added.feed.id] == 2)
    #expect(counts.starred == 1)

    // Adding it again finds the same feed.
    let again = try await local.addFeed(url: "https://stub.example/rss", categoryId: nil)
    #expect(!again.created)

    // Unsubscribing keeps the starred article.
    try await local.removeFeed(added.feed.id)
    #expect(try await local.library().feeds.isEmpty)
    let starred = try await local.articles(.init(starred: true), before: nil, limit: 50)
    #expect(starred.items.map(\.title) == ["One"])
  }

  @Test func failuresAreNotedOnTheFeed() async throws {
    StubProtocol.responses = [
      "https://down.example/feed": (200, rss([("x", "X")]), [:])
    ]
    let local = try backend()
    let feed = try await local.addFeed(url: "https://down.example/feed", categoryId: nil).feed
    StubProtocol.responses["https://down.example/feed"] = (500, "", [:])
    try await local.refresh(feeds: [feed.id])
    let after = try #require(try await local.library().feeds.first)
    #expect(after.lastError?.hasPrefix("500") == true)
    #expect(try await local.counts().unread[feed.id] == 1)

    await #expect(throws: LocalBackend.Failure.noFeed) {
      StubProtocol.responses["https://nothing.example/"] = (200, "<html></html>", [:])
      _ = try await local.addFeed(url: "nothing.example", categoryId: nil)
    }
  }

  @Test func categoriesSettingsAndOPML() async throws {
    let local = try backend()
    let tech = try await local.addCategory(name: "Tech")
    #expect(try await local.addCategory(name: "tech").id == tech.id)
    try await local.updateCategory(tech.id, .init(name: "Technology", collapsed: true))
    #expect(try await local.library().categories.first?.name == "Technology")

    let opml = """
      <opml version="2.0"><body><outline text="Technology">
        <outline text="A" xmlUrl="https://a.example/rss"/></outline>
        <outline text="News"><outline text="B" xmlUrl="https://b.example/rss"/></outline>
      </body></opml>
      """
    let result = try await local.importOPML(Data(opml.utf8))
    #expect(result.added == 2)
    #expect(result.categories == 1)
    let library = try await local.library()
    #expect(library.feeds.first { $0.url == "https://a.example/rss" }?.categoryId == tech.id)

    try await local.deleteCategory(tech.id)
    #expect(
      try await local.library().feeds.first { $0.url == "https://a.example/rss" }?.categoryId
        == uncategorizedId)

    let saved = try await local.saveSettings(
      SyncedSettings(appearance: Appearance(dark: ColorOverrides(accent: "#22c55e"))))
    #expect(saved.appearance?.dark.accent == "#22c55e")
    _ = try await local.saveSettings(SyncedSettings(theme: .dark))
    let settings = try await local.settings()
    #expect(settings.theme == .dark)
    #expect(settings.appearance?.dark.accent == "#22c55e")
  }
}
