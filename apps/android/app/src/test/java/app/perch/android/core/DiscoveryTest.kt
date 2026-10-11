package app.perch.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
  @Test fun findsAdvertisedFeeds() {
    val html = """<html><head><base href="https://cdn.ex.com/">
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
      <link rel="alternate" type="text/html" href="/other">
      <link rel="feed" href="atom.xml">
      <link rel="alternate" type="application/feed+json" href="https://ex.com/feed.json?a=1&amp;b=2">
      </head></html>"""
    assertEquals(
      listOf("https://cdn.ex.com/rss.xml", "https://cdn.ex.com/atom.xml", "https://ex.com/feed.json?a=1&b=2"),
      FeedDiscovery.links(html, "https://ex.com/page"),
    )
  }

  @Test fun guessesUsualPlaces() {
    val guesses = FeedDiscovery.guesses("https://ex.com/some/page?q=1")
    assertEquals("https://ex.com/feed", guesses.first())
    assertTrue("https://ex.com/?feed=rss2" in guesses)
  }

  @Test fun readability() {
    val para = "This is a sentence that is long enough to count as article text for the test. "
    val page = "<html><head><title>Page</title><meta name=\"author\" content=\"Ann\"></head><body><nav>menu</nav>" +
      "<article><h2>Head</h2><p>${para.repeat(8)}</p><img data-src=\"/a.jpg\" src=\"x.gif\"></article><footer>f</footer></body></html>"
    val text = Readability.extract(page)!!
    assertEquals("Page", text.title)
    assertEquals("Ann", text.byline)
    assertTrue(text.html.contains("<img src=\"/a.jpg\""))
    assertTrue(!text.html.contains("menu"))
  }

  @Test fun sanitize() {
    val dirty = "<p onclick=\"x()\">Hi</p><script>bad()</script><a href=\"javascript:alert(1)\">a</a><iframe src=x></iframe>"
    assertEquals("<p>Hi</p><a href=\"#\">a</a>", HtmlText.sanitize(dirty))
  }
}
