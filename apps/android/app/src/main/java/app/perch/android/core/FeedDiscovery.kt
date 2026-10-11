package app.perch.android.core

import java.net.URI

object FeedDiscovery {
  private val baseTag = Regex("(?i)<base\\s[^>]*>")
  private val linkTag = Regex("(?i)<link\\s[^>]*>")
  private val attribute = Regex("([a-zA-Z:-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))")
  private val feedTypes = setOf(
    "application/rss+xml", "application/atom+xml", "application/feed+json", "text/xml",
    "application/xml",
  )

  /** Feed links a page advertises (feedLinksFromHtml in core/discovery/html.ts). */
  fun links(html: String, pageUrl: String): List<String> {
    val head = html.take(200_000)
    var base = runCatching { URI(pageUrl) }.getOrNull() ?: return emptyList()
    baseTag.find(head)?.let { tag ->
      attributes(tag.value)["href"]?.let { href -> runCatching { base = base.resolve(href) } }
    }
    val out = mutableListOf<String>()
    for (match in linkTag.findAll(head)) {
      val a = attributes(match.value)
      val rel = a["rel"].orEmpty().lowercase().split(' ')
      val type = a["type"].orEmpty().lowercase().trim()
      val feedRel = "feed" in rel
      if (!("alternate" in rel || feedRel)) continue
      if (!(type in feedTypes || feedRel)) continue
      val href = a["href"] ?: continue
      val url = runCatching { base.resolve(href.trim()).toString() }.getOrNull() ?: continue
      if (!(url.startsWith("http://") || url.startsWith("https://")) || url in out) continue
      out.add(url)
    }
    return out
  }

  /** Usual feed locations to try when a page names none (core/discovery/candidates.ts). */
  fun guesses(pageUrl: String): List<String> {
    val uri = runCatching { URI(pageUrl) }.getOrNull() ?: return emptyList()
    val root = URI(uri.scheme, uri.rawAuthority, null, null, null).toString()
    return listOf(
      "/feed", "/rss", "/rss.xml", "/atom.xml", "/index.xml", "/feed.xml", "/atom", "/?feed=rss2",
      "/feeds/posts/default", "/blog/feed", "/blog/rss.xml",
    ).map { root + it }
  }

  private fun attributes(tag: String): Map<String, String> = attribute.findAll(tag).associate { m ->
    val value = m.groups[2]?.value ?: m.groups[3]?.value ?: m.groups[4]?.value ?: ""
    m.groupValues[1].lowercase() to HtmlText.decodeEntities(value)
  }
}
