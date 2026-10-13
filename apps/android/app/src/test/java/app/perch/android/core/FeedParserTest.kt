package app.perch.android.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FeedParserTest {
  private fun parse(s: String, url: String? = "https://ex.com/feed.xml") = FeedParser.parse(s.toByteArray(), url)

  @Test fun rss() {
    val feed = parse(
      """<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
      <channel><title>Example &amp; Co</title><link>https://ex.com/</link>
      <image><title>Not the title</title><url>https://ex.com/logo.png</url></image>
      <item><title><![CDATA[Hello <b>world</b>]]></title><link>/posts/1</link><guid>p1</guid>
      <pubDate>Tue, 10 Jun 2003 04:00:00 GMT</pubDate><dc:creator>Ada</dc:creator>
      <description>Short &amp;nbsp; text</description><content:encoded><![CDATA[<p>Full</p>]]></content:encoded>
      <enclosure url="https://ex.com/a.mp3" type="audio/mpeg" length="123"/>
      <media:thumbnail url="https://ex.com/t.jpg"/></item>
      </channel></rss>""",
    )
    assertEquals("Example & Co", feed.title)
    assertEquals("https://ex.com/", feed.siteUrl)
    val item = feed.items.single()
    assertEquals("Hello world", item.title)
    assertEquals("https://ex.com/posts/1", item.url)
    assertEquals("p1", item.guid)
    assertEquals("Ada", item.author)
    assertEquals(1055217600000L, item.published)
    assertEquals("<p>Full</p>", item.contentHtml)
    assertEquals(listOf("audio/mpeg", "image/*"), item.enclosures.map { it.type })
  }

  @Test fun atomWithXhtml() {
    val feed = parse(
      """<feed xmlns="http://www.w3.org/2005/Atom"><title type="html">A &lt;i&gt;blog&lt;/i&gt;</title>
      <link rel="alternate" href="https://ex.com/"/><link rel="self" href="https://ex.com/atom"/>
      <entry><title>Post</title><id>urn:1</id><link href="https://ex.com/1"/>
      <updated>2026-01-02T03:04:05+0100</updated><author><name>Bo</name></author>
      <summary>Plain &lt; text</summary>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p class="x">Hi <b>there</b></p></div></content>
      </entry></feed>""",
    )
    assertEquals("A blog", feed.title)
    assertEquals("https://ex.com/", feed.siteUrl)
    val e = feed.items.single()
    assertEquals("urn:1", e.guid)
    assertEquals("Bo", e.author)
    assertEquals(1767319445000L, e.published)
    assertEquals("<p>Plain &lt; text</p>", e.summaryHtml)
    assertEquals("<div><p class=\"x\">Hi <b>there</b></p></div>", e.contentHtml)
  }

  @Test fun rdf() {
    val feed = parse(
      """<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>RDF</title><link>https://ex.com</link></channel>
      <item><title>One</title><link>https://ex.com/1</link><dc:date>2026-03-01</dc:date></item></rdf:RDF>""",
    )
    assertEquals("RDF", feed.title)
    assertEquals("https://ex.com/1", feed.items.single().url)
    assertNotNull(feed.items.single().published)
  }

  @Test fun jsonFeed() {
    val feed = parse(
      """{"version":"https://jsonfeed.org/version/1.1","title":"J","home_page_url":"https://ex.com",
      "items":[{"id":7,"url":"https://ex.com/7","title":"Seven","content_text":"a < b","date_published":"2026-02-03T00:00:00Z",
      "authors":[{"name":"Cy"}],"image":"https://ex.com/i.png"}]}""",
    )
    val item = feed.items.single()
    assertEquals("7", item.guid)
    assertEquals("<p>a &lt; b</p>", item.contentHtml)
    assertEquals("Cy", item.author)
    assertEquals("image/*", item.enclosures.first().type)
  }

  /** The same feeds as core's parser.test.ts ("which date an item gets"). */
  @Test fun datesPickedAsCoreDoes() {
    val rss = parse(
      """<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>
      <item><title>A</title><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate><dc:date>2025-06-10T00:00:00Z</dc:date></item>
      <item><title>B</title><pubDate>Wed, 11 Jun 2025 09:30:00 +0200</pubDate><dc:date>2025-06-10T00:00:00Z</dc:date></item>
      <item><title>C</title><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item>
      <item><title>D</title><pubDate>Wed, 11 Jun 2025 09:30:00 +0200</pubDate><pubDate>2025-06-10T00:00:00Z</pubDate></item>
      </channel></rss>""",
    )
    assertEquals(
      listOf(1749513600000L, 1749627000000L, null, 1749627000000L),
      rss.items.map { it.published },
    )
    val atom = parse(
      """<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><title>E</title><id>e</id>
      <published>2100-01-01T00:00:00Z</published><updated>2025-06-10T04:00:00Z</updated></entry></feed>""",
    )
    assertEquals(1749528000000L, atom.items.single().published)
    val json = parse(
      """{"version":"https://jsonfeed.org/version/1.1","title":"T",
      "items":[{"id":"1","date_published":"soon","date_modified":"2025-06-10T04:00:00Z"}]}""",
    )
    assertEquals(1749528000000L, json.items.single().published)
  }

  @Test(expected = NotAFeedException::class)
  fun htmlIsNotAFeed() {
    parse("<!doctype html><html><head><title>x</title></head><body>hi</body></html>")
  }

  @Test fun brokenTailStillGivesTheItems() {
    val feed = parse("<rss><channel><title>T</title><item><title>A</title></item></channel></rss>\u0000junk<")
    assertEquals("A", feed.items.single().title)
  }

  @Test fun dates() {
    assertEquals(1055217600000L, FeedDates.parse("Tue, 10 Jun 2003 04:00:00 GMT"))
    assertEquals(1055235600000L, FeedDates.parse("Tue, 10 Jun 2003 04:00:00 EST"))
    assertEquals(1055217600000L, FeedDates.parse("10 Jun 2003 04:00 +0000"))
    assertEquals(1767225600000L, FeedDates.parse("2026-01-01"))
    assertEquals(1767225600000L, FeedDates.parse("2026-01-01 00:00:00"))
    assertNull(FeedDates.parse("soon"))
  }

  /** The list core's dates.test.ts and the iPhone app read, so every app reads a date the same way. */
  @Test fun datesMatchCore() {
    // Unit tests run in apps/android/app.
    val file = File("../../../packages/core/tests/fixtures/dates.json")
    val cases = Json.parseToJsonElement(file.readText()) as JsonArray
    assertTrue(cases.size > 40)
    for (case in cases) {
      val (input, expected) = (case as JsonArray).map { it as JsonPrimitive }
      assertEquals(input.content, expected.contentOrNull?.toLong(), FeedDates.parse(input.content))
    }
  }
}
