package app.perch.android.core

/**
 * Plain text from feed HTML for list previews (htmlToText in
 * packages/core/src/parser/text.ts), and the sanitising every stored copy gets.
 */
object HtmlText {
  private val dropElements = Regex("(?is)<(script|style|noscript|template)\\b.*?</\\1\\s*>")
  private val tags = Regex("<[^>]*>")
  private val spaces = Regex("\\s+")
  private val entity = Regex("&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);")

  fun plain(html: String, limit: Int = 280): String {
    var s = html.replace(dropElements, " ").replace(tags, " ")
    s = decodeEntities(s).replace(spaces, " ").trim()
    if (s.length > limit) s = s.take(limit).trim() + "…"
    return s
  }

  private val named = mapOf(
    "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ",
    "ndash" to "–", "mdash" to "—", "hellip" to "…", "lsquo" to "‘", "rsquo" to "’",
    "ldquo" to "“", "rdquo" to "”", "laquo" to "«", "raquo" to "»", "copy" to "©",
    "reg" to "®", "trade" to "™", "middot" to "·", "bull" to "•", "eacute" to "é",
    "uuml" to "ü", "ouml" to "ö", "ccedil" to "ç",
  )

  fun decodeEntities(text: String): String {
    if (!text.contains('&')) return text
    return entity.replace(text) { m ->
      val body = m.groupValues[1]
      if (body.startsWith("#")) {
        val digits = body.drop(1)
        val code = if (digits.startsWith("x") || digits.startsWith("X")) {
          digits.drop(1).toIntOrNull(16)
        } else {
          digits.toIntOrNull()
        }
        if (code != null && Character.isValidCodePoint(code)) String(Character.toChars(code)) else m.value
      } else {
        named[body] ?: m.value
      }
    }
  }

  private val unsafeElements =
    Regex("(?is)<(script|style|noscript|template|iframe|object|embed|frameset)\\b.*?</\\1\\s*>")
  private val unsafeTags = Regex("(?i)</?(script|style|iframe|object|embed|link|meta|base)\\b[^>]*>")
  private val handlers = Regex("(?i)\\son[a-z]+\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)")
  private val jsLinks = Regex("(?i)(href|src)\\s*=\\s*([\"'])\\s*javascript:[^\"']*\\2")

  /**
   * Feed or page HTML without scripts, styles, frames and event handlers. The
   * reader's WebView has JavaScript off and a strict CSP; this keeps stored
   * copies tidy.
   */
  fun sanitize(html: String): String = html
    .replace(unsafeElements, "")
    .replace(unsafeTags, "")
    .replace(handlers, "")
    .replace(jsLinks) { "${it.groupValues[1]}=\"#\"" }

  fun escape(s: String): String = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
