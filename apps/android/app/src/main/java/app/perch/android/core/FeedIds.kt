package app.perch.android.core

import java.net.URI

/**
 * Ids the way packages/core makes them, so a feed added on Android gets the
 * same id it gets in the extension, on the iPhone or on a Perch Server.
 */
object FeedIds {
  /** FNV-1a, 32-bit, over UTF-16 code units, as hex (fnv1aHex in core/hash.ts). */
  fun fnv1aHex(input: String): String {
    var h = 0x811c9dc5.toInt()
    for (unit in input) {
      h = h xor unit.code
      h *= 0x01000193
    }
    return Integer.toHexString(h).padStart(8, '0')
  }

  /** idFrom in core/hash.ts: the parts joined with NUL. */
  fun idFrom(vararg parts: String): String = fnv1aHex(parts.joinToString("\u0000"))

  /** feedIdFor in core/feeds.ts. */
  fun feed(url: String): String = idFrom("feed", normalizeFeedUrl(url))

  /** toArticle in core/parser/normalize.ts: the guid, else the link, else title and date. */
  fun article(feedId: String, item: ParsedItem, publishedAt: Double): String {
    val identity = item.guid?.takeIf { it.isNotEmpty() }
      ?: item.url?.takeIf { it.isNotEmpty() }
      ?: "${item.title} ${publishedAt.toLong()}"
    return idFrom(feedId, identity)
  }

  /**
   * normalizeFeedUrl in core/url.ts: no fragment, lowercase scheme and host,
   * no trailing slash, no default port.
   */
  fun normalizeFeedUrl(raw: String): String {
    val trimmed = raw.trim()
    val uri = runCatching { URI(trimmed) }.getOrNull() ?: return trimmed
    val scheme = uri.scheme?.lowercase() ?: return trimmed
    val host = uri.host?.lowercase() ?: return trimmed
    var path = uri.rawPath.orEmpty()
    while (path.length > 1 && path.endsWith("/")) path = path.dropLast(1)
    if (path.isEmpty()) path = "/"
    val port = uri.port.takeUnless {
      it == -1 || (scheme == "http" && it == 80) || (scheme == "https" && it == 443)
    }
    return buildString {
      append(scheme).append("://")
      uri.rawUserInfo?.let { append(it).append('@') }
      append(host)
      port?.let { append(':').append(it) }
      append(path)
      uri.rawQuery?.let { append('?').append(it) }
    }
  }
}
