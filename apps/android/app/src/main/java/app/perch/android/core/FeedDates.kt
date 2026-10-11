package app.perch.android.core

import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * RFC 822 (RSS) and ISO 8601 (Atom, JSON Feed, Dublin Core) dates with the
 * usual variations found in the wild. Returns epoch milliseconds.
 */
object FeedDates {
  fun parse(raw: String?): Long? {
    var s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    iso(s)?.let { return it }
    s = s.replace(Regex("\\s+"), " ")
    for ((zone, offset) in zones) {
      if (s.endsWith(" $zone")) {
        s = s.dropLast(zone.length) + offset
        break
      }
    }
    for (format in rfc822) {
      runCatching { return OffsetDateTime.parse(s, format).toInstant().toEpochMilli() }
      runCatching {
        return java.time.LocalDateTime.parse(s, format).toInstant(ZoneOffset.UTC).toEpochMilli()
      }
      runCatching {
        return java.time.LocalDate.parse(s, format).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
      }
    }
    return null
  }

  private fun iso(s: String): Long? {
    if (s.length < 10 || !s[0].isDigit()) return null
    var text = s.replaceFirst(' ', 'T')
    if (text.length == 10) text += "T00:00:00Z"
    if (Regex("\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d(:\\d\\d(\\.\\d+)?)?").matches(text)) text += "Z"
    Regex("([+-]\\d\\d)(\\d\\d)$").find(text)?.let {
      text = text.substring(0, it.range.first) + "${it.groupValues[1]}:${it.groupValues[2]}"
    }
    return runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
  }

  private val rfc822 = listOf(
    "EEE, d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm Z", "d MMM yyyy HH:mm:ss Z",
    "d MMM yyyy HH:mm Z", "EEE, d MMM yy HH:mm:ss Z", "EEE, d MMMM yyyy HH:mm:ss Z",
    "EEE d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm:ss", "EEE, d MMM yyyy",
  ).map { DateTimeFormatter.ofPattern(it, Locale.US) }

  private val zones = listOf(
    "GMT" to "+0000", "UTC" to "+0000", "UT" to "+0000", "Z" to "+0000",
    "EST" to "-0500", "EDT" to "-0400", "CST" to "-0600", "CDT" to "-0500",
    "MST" to "-0700", "MDT" to "-0600", "PST" to "-0800", "PDT" to "-0700",
  )
}
