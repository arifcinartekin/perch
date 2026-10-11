package app.perch.android.core

import java.io.ByteArrayInputStream
import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * A feed as published: RSS 2.0, RSS 1.0 (RDF), Atom or JSON Feed, the same
 * formats packages/core/src/parser and the iPhone app read.
 */
data class ParsedFeed(val title: String, val siteUrl: String?, val items: List<ParsedItem>)

data class ParsedItem(
  val guid: String? = null,
  val url: String? = null,
  val title: String = "",
  val author: String? = null,
  val published: Long? = null,
  val summaryHtml: String? = null,
  val contentHtml: String? = null,
  val enclosures: List<Enclosure> = emptyList(),
)

/** Parsed, but not a feed (an HTML page, usually). */
class NotAFeedException : Exception("Not a feed")

object FeedParser {
  /** Parses feed bytes; relative links resolve against [url]. */
  fun parse(data: ByteArray, url: String? = null): ParsedFeed {
    val head = String(data, 0, minOf(512, data.size), Charsets.UTF_8).trim().trimStart('\uFEFF')
    val feed = if (head.startsWith("{")) json(data) else xml(data)
    return if (url != null) resolve(feed, url) else feed
  }

  // JSON Feed

  private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

  private fun json(data: ByteArray): ParsedFeed {
    val root = runCatching { lenient.parseToJsonElement(data.decodeToString()).jsonObject }
      .getOrNull() ?: throw NotAFeedException()
    fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull
    val items = root["items"] as? JsonArray
    if (root.str("version")?.contains("jsonfeed.org") != true && items == null) {
      throw NotAFeedException()
    }
    val parsed = items.orEmpty().mapNotNull { it as? JsonObject }.map { item ->
      val enclosures = (item["attachments"] as? JsonArray).orEmpty().mapNotNull { a ->
        val o = a as? JsonObject ?: return@mapNotNull null
        val u = o.str("url") ?: return@mapNotNull null
        Enclosure(u, o.str("mime_type"), (o["size_in_bytes"] as? JsonPrimitive)?.doubleOrNull)
      }.toMutableList()
      item.str("image")?.let { enclosures.add(0, Enclosure(it, "image/*")) }
      val authors = (item["authors"] as? JsonArray)?.firstOrNull() as? JsonObject
      val author = authors?.str("name") ?: (item["author"] as? JsonObject)?.str("name")
      ParsedItem(
        guid = item.str("id"),
        url = item.str("url") ?: item.str("external_url"),
        title = plainTitle(item.str("title").orEmpty()),
        author = author,
        published = FeedDates.parse(item.str("date_published") ?: item.str("date_modified")),
        summaryHtml = item.str("summary")?.let(HtmlText::escape),
        contentHtml = item.str("content_html")
          ?: item.str("content_text")?.let { "<p>${HtmlText.escape(it)}</p>" },
        enclosures = enclosures,
      )
    }
    return ParsedFeed(root.str("title").orEmpty(), root.str("home_page_url"), parsed)
  }

  // XML

  private object NS {
    const val ATOM = "http://www.w3.org/2005/Atom"
    const val CONTENT = "http://purl.org/rss/1.0/modules/content/"
    const val DC = "http://purl.org/dc/elements/1.1/"
    const val MEDIA = "http://search.yahoo.com/mrss/"
    const val RSS1 = "http://purl.org/rss/1.0/"
    const val RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  }

  private enum class Kind { RSS, ATOM }

  private class ItemBuilder {
    var guid: String? = null
    var url: String? = null
    var title = ""
    var author: String? = null
    var published: Long? = null
    var summary: String? = null
    var content: String? = null
    val enclosures = mutableListOf<Enclosure>()
    fun build() = ParsedItem(guid, url, title, author, published, summary, content, enclosures.toList())
  }

  /**
   * Walks RSS, RDF and Atom in one pass. Feed-level fields come only from
   * direct children of the channel/feed, so an `<image><title>` isn't taken
   * for the feed's title. A parse error after the items still leaves a feed.
   */
  private fun xml(data: ByteArray): ParsedFeed {
    val parser = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser()
    // Feeds often use HTML entities (&nbsp;) that XML doesn't define.
    runCatching { parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true) }
    parser.setInput(ByteArrayInputStream(data), null)

    var kind: Kind? = null
    val stack = ArrayList<Pair<String, String>>()
    val text = StringBuilder()
    var title: String? = null
    var siteUrl: String? = null
    val items = mutableListOf<ParsedItem>()
    var item: ItemBuilder? = null
    var textType = "text"
    var xhtmlDepth = 0

    fun parentName() = if (stack.size >= 2) stack[stack.size - 2].first else null
    fun html(value: String): String? =
      if (value.isEmpty()) null else if (textType == "text") "<p>${HtmlText.escape(value)}</p>" else value

    try {
      var event = parser.eventType
      while (event != XmlPullParser.END_DOCUMENT) {
        when (event) {
          XmlPullParser.START_TAG -> {
            val name = parser.name
            val ns = parser.namespace.orEmpty()
            fun attr(n: String): String? = parser.getAttributeValue(null, n)
            if (xhtmlDepth > 0) {
              xhtmlDepth++
              text.append('<').append(name)
              for (i in 0 until parser.attributeCount) {
                text.append(' ').append(parser.getAttributeName(i)).append("=\"")
                  .append(HtmlText.escape(parser.getAttributeValue(i))).append('"')
              }
              text.append('>')
            } else {
              stack.add(name to ns)
              text.setLength(0)
              when {
                name == "rss" || (name == "RDF" && ns == NS.RDF) ||
                  (name == "channel" && (ns.isEmpty() || ns == NS.RSS1)) -> if (kind == null) kind = Kind.RSS
                name == "feed" && ns == NS.ATOM -> if (kind == null) kind = Kind.ATOM
                (name == "item" && (ns.isEmpty() || ns == NS.RSS1)) || (name == "entry" && ns == NS.ATOM) ->
                  item = ItemBuilder()
              }
              val current = item
              if (current != null) {
                when {
                  name == "link" && ns == NS.ATOM && kind == Kind.ATOM -> {
                    val rel = attr("rel") ?: "alternate"
                    val href = attr("href")
                    if (href != null) {
                      if (rel == "alternate" && current.url == null) {
                        current.url = href
                      } else if (rel == "enclosure") {
                        current.enclosures.add(Enclosure(href, attr("type"), attr("length")?.toDoubleOrNull()))
                      }
                    }
                  }
                  name == "enclosure" && ns.isEmpty() -> attr("url")?.let {
                    current.enclosures.add(Enclosure(it, attr("type"), attr("length")?.toDoubleOrNull()))
                  }
                  (name == "content" || name == "thumbnail") && ns == NS.MEDIA -> attr("url")?.let { u ->
                    val type = attr("type")
                      ?: if (name == "thumbnail" || attr("medium") == "image") "image/*" else null
                    if (current.enclosures.none { it.url == u }) current.enclosures.add(Enclosure(u, type))
                  }
                  (name == "content" || name == "summary" || name == "title") && ns == NS.ATOM -> {
                    textType = attr("type") ?: "text"
                    if (textType == "xhtml") xhtmlDepth = 1
                  }
                }
              } else if (kind == Kind.ATOM && name == "link" && ns == NS.ATOM && parentName() == "feed") {
                if ((attr("rel") ?: "alternate") == "alternate" && siteUrl == null) siteUrl = attr("href")
              } else if (name == "title" && ns == NS.ATOM) {
                textType = attr("type") ?: "text"
              }
            }
          }
          XmlPullParser.TEXT -> {
            val t = parser.text.orEmpty()
            text.append(if (xhtmlDepth > 0) HtmlText.escape(t) else t)
          }
          XmlPullParser.END_TAG -> {
            val name = parser.name
            val ns = parser.namespace.orEmpty()
            if (xhtmlDepth > 1) {
              xhtmlDepth--
              text.append("</").append(name).append('>')
            } else {
              xhtmlDepth = 0
              val value = text.toString().trim()
              val current = item
              if (current != null) {
                when {
                  (name == "item" && (ns.isEmpty() || ns == NS.RSS1)) || (name == "entry" && ns == NS.ATOM) -> {
                    items.add(current.build())
                    item = null
                  }
                  name == "title" && ns != NS.MEDIA -> current.title = plainTitle(value)
                  name == "link" && (ns.isEmpty() || ns == NS.RSS1) ->
                    if (current.url == null && value.isNotEmpty()) current.url = value
                  (name == "guid" && ns.isEmpty()) || (name == "id" && ns == NS.ATOM) ->
                    current.guid = value.ifEmpty { null }
                  (name == "pubDate" && ns.isEmpty()) || (name == "date" && ns == NS.DC) ||
                    (name == "published" && ns == NS.ATOM) ->
                    current.published = FeedDates.parse(value) ?: current.published
                  (name == "updated" || name == "modified") && ns == NS.ATOM ->
                    if (current.published == null) current.published = FeedDates.parse(value)
                  (name == "creator" && ns == NS.DC) || (name == "author" && ns.isEmpty()) ->
                    if (current.author == null && value.isNotEmpty()) current.author = value
                  name == "name" && ns == NS.ATOM && parentName() == "author" ->
                    if (current.author == null && value.isNotEmpty()) current.author = value
                  name == "description" && (ns.isEmpty() || ns == NS.RSS1) -> current.summary = value.ifEmpty { null }
                  name == "encoded" && ns == NS.CONTENT -> current.content = value.ifEmpty { null }
                  name == "summary" && ns == NS.ATOM -> current.summary = html(value)
                  name == "content" && ns == NS.ATOM -> current.content = html(value)
                }
              } else {
                val parent = parentName()
                if (name == "title" && (parent == "channel" || parent == "feed")) {
                  if (title == null) title = plainTitle(value)
                } else if (name == "link" && (ns.isEmpty() || ns == NS.RSS1) && parent == "channel") {
                  if (siteUrl == null && value.isNotEmpty()) siteUrl = value
                }
              }
              if (stack.isNotEmpty()) stack.removeAt(stack.size - 1)
              text.setLength(0)
            }
          }
        }
        event = parser.next()
      }
    } catch (e: Exception) {
      if (kind == null) throw NotAFeedException()
    }
    if (kind == null) throw NotAFeedException()
    return ParsedFeed(title.orEmpty(), siteUrl, items)
  }

  // Helpers

  /** Titles are text; some feeds put markup or entities in them anyway. */
  fun plainTitle(s: String): String =
    if (!s.contains('<') && !s.contains('&')) s.trim() else HtmlText.plain(s, limit = 1000)

  private fun resolve(feed: ParsedFeed, base: String): ParsedFeed {
    val baseUri = runCatching { URI(base) }.getOrNull() ?: return feed
    fun absolute(s: String?): String? {
      if (s.isNullOrBlank()) return null
      return runCatching { baseUri.resolve(s.trim().replace(" ", "%20")).toString() }.getOrDefault(s)
    }
    return feed.copy(
      siteUrl = absolute(feed.siteUrl),
      items = feed.items.map { item ->
        item.copy(
          url = absolute(item.url),
          enclosures = item.enclosures.mapNotNull { e -> absolute(e.url)?.let { e.copy(url = it) } },
        )
      },
    )
  }
}
