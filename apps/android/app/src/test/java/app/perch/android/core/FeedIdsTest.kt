package app.perch.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** Expected values come from packages/core, so ids match across every Perch app. */
class FeedIdsTest {
  @Test fun normalizesLikeCore() {
    assertEquals("https://example.com/feed", FeedIds.normalizeFeedUrl("https://Example.com/feed/"))
    assertEquals("http://example.com/a", FeedIds.normalizeFeedUrl("http://example.com:80/a//"))
    assertEquals("https://ex.com/feed?x=1", FeedIds.normalizeFeedUrl("https://ex.com/feed?x=1#top"))
  }

  @Test fun feedIdsMatchCore() {
    assertEquals("41788b4e", FeedIds.feed("https://Example.com/feed/"))
    assertEquals("11d44196", FeedIds.feed("http://example.com:80/a//"))
    assertEquals("e1d004f5", FeedIds.feed("https://www.nature.com/nature.rss"))
    assertEquals("7811de6e", FeedIds.feed("https://ex.com/feed?x=1#top"))
  }

  @Test fun hashesUtf16LikeCore() {
    assertEquals("dd58ef19", FeedIds.fnv1aHex("Perch – ğüş 🐦"))
  }

  @Test fun articleIdsUseTheGuidFirst() {
    val feed = FeedIds.feed("https://ex.com/feed")
    val item = ParsedItem(guid = "tag:ex.com,2026:1", url = "https://ex.com/1", title = "One")
    assertEquals("5e5c89d0", FeedIds.article(feed, item, 0.0))
  }

  @Test fun articleIdsFallBackToTitleAndDateLikeCore() {
    val feed = FeedIds.feed("https://ex.com/feed")
    val item = ParsedItem(guid = null, url = null, title = "One")
    assertEquals("483ee61f", FeedIds.article(feed, item, 1_767_225_600_000.0))
    // Undated: the apps pass 0, as core does.
    assertEquals("ddec0483", FeedIds.article(feed, item, 0.0))
  }
}
