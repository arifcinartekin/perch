import Foundation
import Testing

@testable import PerchKit

// Vectors from deriveKeys() in packages/core/src/auth.ts (hash-wasm). If these
// drift, an iPhone could never sign in to an account made in the browser.
@Suite struct KeyDerivationTests {
  let salt = "AAECAwQFBgcICQoLDA0ODw"

  @Test func matchesTheWebClientAtTheDefaultCost() throws {
    let keys = try KeyDerivation.deriveSync(
      password: "correct horse battery staple", salt: salt, params: .default)
    #expect(keys.authKey == "FDraHTNhtuHuOHYUTGyFX5brj8BAd-twiMlacL5TQ_I")
    #expect(keys.masterKey.base64URLEncoded() == "hQ8a08dIrJrZOCiIkojGzluIyICxwlJ3WqAawHXOV58")
  }

  @Test func normalisesThePasswordAndHonoursParallelism() throws {
    let keys = try KeyDerivation.deriveSync(
      password: "ﬁancé Ⅻ", salt: salt,
      params: KdfParams(memory: 8192, iterations: 2, parallelism: 2))
    #expect(keys.authKey == "vbqIpdmATSpme47QMatSTTavq_6CdMU9y28nxmKMeLY")
    #expect(keys.masterKey.base64URLEncoded() == "BWZcwa_Si385wdNWMyvVHI0MPH82DNgCtl_GSvCjdu0")
  }

  @Test func refusesParametersOutsideTheServerLimits() {
    #expect(throws: KeyDerivationError.self) {
      try KeyDerivation.deriveSync(
        password: "x", salt: salt, params: KdfParams(memory: 1024, iterations: 1, parallelism: 1))
    }
  }

  @Test func newSaltsAreSixteenRandomBytes() {
    let a = KeyDerivation.newSalt()
    #expect(Data(base64URL: a)?.count == 16)
    #expect(a != KeyDerivation.newSalt())
  }
}

@Suite struct ModelTests {
  @Test func decodesAnArticleWithNumericFlags() throws {
    let json = """
      {"id":"a1","feedId":"f1","title":"Hello","publishedAt":1700000000000,
       "enclosures":[],"read":1,"starred":0,"fetchedAt":1700000000000,"guid":"x"}
      """
    let article = try JSONDecoder().decode(Article.self, from: Data(json.utf8))
    #expect(article.id == "f1:a1")
    #expect(article.read)
    #expect(!article.starred)
    #expect(article.published == Date(timeIntervalSince1970: 1_700_000_000))
  }

  @Test func settingsIgnoreUnknownAndMalformedValues() throws {
    let json =
      #"{"theme":"dark","readingFont":"comic","glass":{"enabled":false,"transparency":50,"blur":24},"x":1}"#
    let s = try JSONDecoder().decode(SyncedSettings.self, from: Data(json.utf8))
    #expect(s.theme == .dark)
    #expect(s.readingFont == nil)
    #expect(s.glass?.enabled == false)
  }

  @Test func readsEmailSignupAndUnknownPoliciesInServerInfo() throws {
    func info(_ signup: String) throws -> ServerInfo {
      let json =
        #"{"software":"perch-server","version":"0.1.0","mode":"personal","signup":"\#(signup)","community":false,"needsSetup":false,"email":true}"#
      return try JSONDecoder().decode(ServerInfo.self, from: Data(json.utf8))
    }
    #expect(try info("email").signup == .email)
    #expect(try info("email").email == true)
    #expect(try info("something-new").signup == .closed)
  }

  @Test func normalisesServerAddresses() {
    #expect(
      APIClient.normalizeServerURL("perch.example.com")?.absoluteString
        == "https://perch.example.com")
    #expect(
      APIClient.normalizeServerURL(" http://192.168.1.5:8080/reader?x=1 ")?.absoluteString
        == "http://192.168.1.5:8080")
    #expect(APIClient.normalizeServerURL("ftp://x") == nil)
    #expect(APIClient.normalizeServerURL("") == nil)
  }
}

@Suite struct EventStreamTests {
  @Test func parsesPerchEventsWithOrWithoutBlankLines() {
    var parser = EventStreamParser()
    let lines = [
      "event: cursor", "data: 41", "", ": keep-alive", "event: articles", "data:", "event: cursor",
      "data: 42",
    ]
    let events = lines.compactMap { parser.feed($0) }
    #expect(events == [.cursor("41"), .articles, .cursor("42")])
  }
}

@Suite struct HTMLTextTests {
  @Test func stripsTagsAndDecodesEntities() {
    let html =
      "<p>Android&#8217;s <b>new</b>&nbsp;thing &amp; more</p><script>x()</script><style>p{}</style>"
    #expect(HTMLText.plain(html) == "Android’s new thing & more")
  }

  @Test func truncatesLongText() {
    #expect(HTMLText.plain(String(repeating: "a ", count: 400), limit: 10).hasSuffix("…"))
  }
}

/// Against a running server: PERCH_TEST_SERVER=http://localhost:8080
/// PERCH_TEST_USER=… PERCH_TEST_PASSWORD=… swift test
@Suite(.enabled(if: ProcessInfo.processInfo.environment["PERCH_TEST_SERVER"] != nil))
struct LiveServerTests {
  let env = ProcessInfo.processInfo.environment

  @Test func signsInAndReadsTheLibrary() async throws {
    let server = try #require(APIClient.normalizeServerURL(env["PERCH_TEST_SERVER"] ?? ""))
    let auth = try await APIClient(baseURL: server).login(
      username: env["PERCH_TEST_USER"] ?? "", password: env["PERCH_TEST_PASSWORD"] ?? "",
      deviceName: "PerchKit tests")
    let client = APIClient(baseURL: server, token: auth.token)
    let library = try await client.library()
    let page = try await client.articles(.init(unreadOnly: true), limit: 5)
    #expect(!library.feeds.isEmpty)
    #expect(page.items.count <= 5)
    if let first = page.items.first {
      try await client.setState([first.ref], starred: true)
      #expect(try await client.counts().starred >= 1)
      try await client.setState([first.ref], starred: false)
    }
    var events = client.events().makeAsyncIterator()
    #expect(try await events.next() != nil)
    try await client.logout()
    await #expect(throws: APIError.self) { try await client.me() }
  }

  @Test func rejectsAWrongPassword() async throws {
    let server = try #require(APIClient.normalizeServerURL(env["PERCH_TEST_SERVER"] ?? ""))
    let error = await #expect(throws: APIError.self) {
      try await APIClient(baseURL: server).login(
        username: env["PERCH_TEST_USER"] ?? "", password: "definitely wrong", deviceName: "tests")
    }
    #expect(error?.code == "invalid-credentials")
  }
}
