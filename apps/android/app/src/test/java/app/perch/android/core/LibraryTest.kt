package app.perch.android.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryTest {
  @Test fun opmlRoundTrip() {
    val library = Library(
      feeds = listOf(
        Feed("a", "https://a.com/feed", "A & B", categoryId = "c1"),
        Feed("b", "https://b.com/rss", "B"),
      ),
      categories = listOf(Category("c1", "Tech", 10.0)),
    )
    val outlines = Opml.parse(Opml.build(library).toByteArray())
    assertEquals(
      listOf(Opml.Outline("https://b.com/rss", "B", null), Opml.Outline("https://a.com/feed", "A & B", "Tech")),
      outlines,
    )
  }

  @Test fun palettesMatchCore() {
    val light = Theme.palette(ColorMode.LIGHT)
    assertEquals("#f7f5f0", light.background)
    assertEquals("#b35512", light.accentText)
    val custom = Theme.palette(ColorMode.LIGHT, ColorOverrides(background = "#000", accent = "#3b82f6"))
    assertEquals(ColorMode.DARK, custom.scheme)
    assertEquals("#0f0f0f", custom.solid)
    assertEquals("#12151c", custom.accentContrast)
    assertEquals("#3b82f6", custom.accentText)
  }

  @Test fun starterPacksParseAndPutTheLanguageFirst() {
    val packs = StarterPacks.parse(File("src/main/assets/starter-packs.json").readText())
    assertTrue(packs.size >= 9)
    assertTrue(packs.all { it.feeds.isNotEmpty() })
    assertEquals("tr", StarterPacks.forLanguage(packs, "tr").first().lang)
    assertEquals("en", StarterPacks.forLanguage(packs, "en").first().lang)
  }
}
