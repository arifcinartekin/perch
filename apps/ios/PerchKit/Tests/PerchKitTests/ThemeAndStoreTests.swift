import Foundation
import Testing

@testable import PerchKit

// Vectors from buildThemeVars() in packages/core/src/theme.ts: a colour picked
// in the extension must come out the same on the phone.
@Suite struct ThemeTests {
  @Test func defaultsAreTheStylesheetPalette() {
    let p = Theme.palette(.light)
    #expect(p.background == "#f7f5f0")
    #expect(p.accentText == "#b35512")
    #expect(Theme.palette(.dark).text == "#f4f1ea")
  }

  @Test func customAccentGetsAReadableTextForm() {
    let p = Theme.palette(.light, ColorOverrides(accent: "#3b82f6"))
    #expect(p.solid == "#fdfcfb")
    #expect(p.accentText == "#2f68c5")
    #expect(p.accentContrast == "#12151c")
  }

  @Test func theBackgroundPicksTheScheme() {
    let p = Theme.palette(.dark, ColorOverrides(background: "#FDF6E3"))
    #expect(p.scheme == .light)
    #expect(p.solid == "#fefcf7")
    #expect(p.text == "#12151c")
    #expect(p.accentText == "#b35512")

    let q = Theme.palette(.light, ColorOverrides(background: "#1e1e2e", text: "#cdd6f4"))
    #expect(q.scheme == .dark)
    #expect(q.solid == "#2c2c3b")
    #expect(q.textMuted == "#9096af")
    #expect(q.textFaint == "#64687d")
  }

  @Test func customTextDrivesTheGreys() {
    let p = Theme.palette(
      .dark, ColorOverrides(text: "#ffffff", accent: "#22c55e", button: "#fde047"))
    #expect(p.solid == "#1c1f26")
    #expect(p.textMuted == "#abacae")
    #expect(p.textFaint == "#6e7074")
    #expect(p.accentText == "#22c55e")
    #expect(p.buttonContrast == "#12151c")
  }

  @Test func ignoresJunkColours() throws {
    let json = ##"{"light":{"accent":"nope","background":"#ABC"},"dark":7}"##
    let a = try JSONDecoder().decode(Appearance.self, from: Data(json.utf8))
    #expect(a.light.accent == nil)
    #expect(a.light.background == "#aabbcc")
    #expect(a.dark.isEmpty)
  }

  @Test func glassClampsAndScales() {
    #expect(GlassSettings(enabled: true, transparency: 100, blur: 99).normalized.blur == 40)
    #expect(GlassSettings(enabled: true, transparency: 100, blur: 0).clarity == 2)
    #expect(GlassSettings(enabled: false).clarity == 0)
  }
}

@Suite struct OfflineStoreTests {
  func makeStore() throws -> OfflineStore {
    let url = FileManager.default.temporaryDirectory
      .appending(path: "perch-tests-\(UUID().uuidString)/offline.sqlite")
    return try OfflineStore(url: url)
  }

  func article(
    _ id: String, feed: String = "f1", at: Double, title: String = "T", read: Bool = false
  )
    throws -> Article
  {
    let json = """
      {"id":"\(id)","feedId":"\(feed)","title":"\(title)","publishedAt":\(at),"enclosures":[],
       "read":\(read ? 1 : 0),"starred":0,"summaryHtml":"<p>Çay &amp; simit</p>"}
      """
    return try JSONDecoder().decode(Article.self, from: Data(json.utf8))
  }

  @Test func queriesLikeTheServer() async throws {
    let store = try makeStore()
    await store.store([
      try article("a", at: 3, title: "Swift on iPhone"),
      try article("b", feed: "f2", at: 2, read: true),
      try article("c", at: 1),
    ])
    #expect(await store.articles(.init()).map(\.articleId) == ["a", "b", "c"])
    #expect(await store.articles(.init(unreadOnly: true)).map(\.articleId) == ["a", "c"])
    #expect(await store.articles(.init(feedIds: ["f2"])).map(\.articleId) == ["b"])
    #expect(await store.articles(.init(search: "iphone")).map(\.articleId) == ["a"])
    #expect(await store.articles(.init(search: "cay")).count == 3)
    #expect(await store.articles(.init(), before: 3, limit: 1).map(\.articleId) == ["b"])
    #expect(await store.unreadCounts() == ["f1": 2])
  }

  @Test func pendingChangesSurviveAStalePage() async throws {
    let store = try makeStore()
    let a = try article("a", at: 1)
    await store.store([a])
    await store.setState(a.id, read: true)
    await store.enqueue(a.ref, read: true)
    await store.enqueue(a.ref, starred: true)
    // The server hasn't seen the change yet and sends the old state back.
    await store.store([a])
    let stored = try #require(await store.article(a.id))
    #expect(stored.read && stored.starred)
    let pending = await store.pending()
    #expect(pending.count == 1 && pending[0].read == true && pending[0].starred == true)
    await store.clearPending(pending)
    #expect(await store.pending().isEmpty)
  }

  @Test func trimKeepsStarredAndSnapshotsRoundTrip() async throws {
    let store = try makeStore()
    var starred = try article("old", at: 1)
    starred.starred = true
    await store.store([starred, try article("new", at: 2), try article("newer", at: 3)])
    await store.trim(keep: 1)
    #expect(Set(await store.articles(.init()).map(\.articleId)) == ["newer", "old"])

    await store.saveSnapshot(
      library: Library(), counts: Counts(unread: ["f1": 4], starred: 1),
      settings: SyncedSettings(theme: .dark))
    #expect(await store.snapshot()?.counts.unread["f1"] == 4)
    #expect(await store.snapshot()?.settings.theme == .dark)
  }
}
