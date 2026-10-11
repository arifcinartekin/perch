package app.perch.android.core

import java.io.ByteArrayInputStream
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * OPML subscription lists (core/opml.ts): outlines with an xmlUrl, grouped by
 * their parent outline's title.
 */
object Opml {
  data class Outline(val url: String, val title: String?, val category: String?)

  fun parse(data: ByteArray): List<Outline> {
    val parser = XmlPullParserFactory.newInstance().newPullParser()
    runCatching { parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true) }
    parser.setInput(ByteArrayInputStream(data), null)
    val out = mutableListOf<Outline>()
    val groups = ArrayList<String?>()
    var sawOpml = false
    try {
      var event = parser.eventType
      while (event != XmlPullParser.END_DOCUMENT) {
        if (event == XmlPullParser.START_TAG) {
          val name = parser.name.lowercase()
          if (name == "opml") sawOpml = true
          if (name == "outline") {
            fun attr(n: String) = parser.getAttributeValue(null, n)
            val title = (attr("title") ?: attr("text"))?.trim()
            val url = attr("xmlUrl") ?: attr("xmlurl")
            if (!url.isNullOrEmpty()) {
              out.add(Outline(url, title, groups.lastOrNull { it != null }))
              groups.add(null)
            } else {
              groups.add(title?.takeIf { it.isNotEmpty() })
            }
          }
        } else if (event == XmlPullParser.END_TAG && parser.name.lowercase() == "outline") {
          if (groups.isNotEmpty()) groups.removeAt(groups.size - 1)
        }
        event = parser.next()
      }
    } catch (e: Exception) {
      if (out.isEmpty()) throw NotAFeedException()
    }
    if (!sawOpml) throw NotAFeedException()
    return out
  }

  fun build(library: Library, title: String = "Perch subscriptions"): String {
    fun esc(s: String) = HtmlText.escape(s).replace("\"", "&quot;")
    fun line(f: Feed, indent: String) = buildString {
      append(indent).append("<outline type=\"rss\" text=\"").append(esc(f.displayTitle))
      append("\" title=\"").append(esc(f.displayTitle)).append("\" xmlUrl=\"").append(esc(f.url)).append('"')
      f.siteUrl?.let { append(" htmlUrl=\"").append(esc(it)).append('"') }
      append("/>")
    }
    val byCategory = library.feeds.groupBy { it.categoryId }
    val lines = mutableListOf(
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<opml version=\"2.0\">",
      "  <head><title>${esc(title)}</title></head>", "  <body>",
    )
    byCategory[UNCATEGORIZED_ID].orEmpty().forEach { lines.add(line(it, "    ")) }
    for (c in library.categories.sortedBy { it.order }) {
      if (c.id == UNCATEGORIZED_ID) continue
      val feeds = byCategory[c.id].orEmpty()
      if (feeds.isEmpty()) continue
      lines.add("    <outline text=\"${esc(c.name)}\" title=\"${esc(c.name)}\">")
      feeds.forEach { lines.add(line(it, "      ")) }
      lines.add("    </outline>")
    }
    lines += listOf("  </body>", "</opml>", "")
    return lines.joinToString("\n")
  }
}
