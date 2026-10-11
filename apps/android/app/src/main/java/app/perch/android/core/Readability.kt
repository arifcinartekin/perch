package app.perch.android.core

/**
 * The readable part of a web page, for full text without a server. A small
 * heuristic (the iPhone app's), not Mozilla's Readability: the page's
 * `<article>` or `<main>` when it has enough text, else its paragraphs in order.
 */
object Readability {
  private val body = Regex("(?is)<body\\b[^>]*>(.*)</body>")
  private val furniture =
    Regex("(?is)<(nav|header|footer|aside|form|button|select|svg|dialog|menu)\\b.*?</\\1\\s*>")
  private val article = Regex("(?is)<article\\b[^>]*>(.*?)</article\\s*>")
  private val main = Regex("(?is)<main\\b[^>]*>(.*?)</main\\s*>")
  private val blocks = Regex("(?is)<(p|h2|h3|h4|blockquote|pre|ul|ol|figure)\\b[^>]*>.*?</\\1\\s*>")
  private val img = Regex("(?i)<img\\b[^>]*>")
  private val lazySrc = Regex("(?i)\\sdata-(?:src|original|lazy-src)\\s*=\\s*[\"']([^\"']+)[\"']")
  private val src = Regex("(?i)\\ssrc\\s*=\\s*[\"'][^\"']*[\"']")
  private val metaTag = Regex("(?i)<meta\\s[^>]*>")
  private val metaKey = Regex("(?i)\\s(?:property|name)\\s*=\\s*[\"']([^\"']+)[\"']")
  private val metaContent = Regex("(?i)\\scontent\\s*=\\s*[\"']([^\"']*)[\"']")
  private val titleTag = Regex("(?is)<title\\b[^>]*>(.*?)</title>")

  fun extract(html: String): FullText? {
    val title = meta(html, "og:title") ?: pageTitle(html)
    val byline = meta(html, "author")
    var doc = body.find(html)?.groupValues?.get(1) ?: html
    doc = HtmlText.sanitize(doc).replace(furniture, "")
    val candidates = article.findAll(doc).map { it.groupValues[1] } + main.findAll(doc).map { it.groupValues[1] }
    val best = candidates.maxByOrNull(::textLength)
    var content = if (best != null && textLength(best) >= 400) {
      best
    } else {
      blocks.findAll(doc).map { it.value }
        .filter { !it.startsWith("<p") || textLength(it) >= 40 }
        .joinToString("\n")
    }
    content = lazyImages(content)
    if (textLength(content) < 200) return null
    return FullText(content, title, byline)
  }

  private fun textLength(html: String) = HtmlText.plain(html, Int.MAX_VALUE).length

  /** `<img data-src>` and friends, which only load with the page's scripts. */
  private fun lazyImages(html: String) = img.replace(html) { m ->
    val lazy = lazySrc.find(m.value) ?: return@replace m.value
    m.value.replace(src, "").replaceFirst(Regex("(?i)^<img"), "<img src=\"${lazy.groupValues[1]}\"")
  }

  private fun meta(html: String, name: String): String? {
    for (tag in metaTag.findAll(html.take(100_000))) {
      val key = metaKey.find(tag.value)?.groupValues?.get(1) ?: continue
      if (key.lowercase() != name) continue
      val value = metaContent.find(tag.value)?.groupValues?.get(1) ?: continue
      val text = HtmlText.decodeEntities(value).trim()
      if (text.isNotEmpty()) return text
    }
    return null
  }

  private fun pageTitle(html: String): String? =
    titleTag.find(html)?.let { HtmlText.plain(it.groupValues[1], 300) }?.takeIf { it.isNotEmpty() }
}
