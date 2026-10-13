package app.perch.android.core

import java.time.LocalDate
import java.time.ZoneOffset

/**
 * RFC 822 (RSS) and ISO 8601 (Atom, JSON Feed, Dublin Core) dates with the
 * usual variations found in the wild. Returns epoch milliseconds.
 *
 * parseDate in core/parser/dates.ts, rule for rule: an item keyed on its date
 * must get the same id on every device. packages/core/tests/fixtures/dates.json
 * pins the three.
 */
object FeedDates {
  /**
   * resolvePublishedAt in core/parser/dates.ts: the first candidate that
   * parses and isn't more than a day in the future, or null (undated).
   */
  fun pick(candidates: List<String?>, now: Long = System.currentTimeMillis()): Long? {
    val maxFuture = now + 24 * 60 * 60 * 1000L
    return candidates.firstNotNullOfOrNull { c -> parse(c)?.takeIf { it <= maxFuture } }
  }

  private val months = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

  /** RFC 822 zone names, in hours from UTC. Any other name counts as UTC. */
  private val zones = mapOf(
    "GMT" to 0, "UT" to 0, "UTC" to 0, "Z" to 0, "EST" to -5, "EDT" to -4,
    "CST" to -6, "CDT" to -5, "MST" to -7, "MDT" to -6, "PST" to -8, "PDT" to -7,
  )

  private val iso = Regex(
    "^(\\d{4})-(\\d{2})-(\\d{2})(?:[Tt ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?)?\\s*([Zz]|[+-]\\d{2}:?\\d{2})?$",
  )
  private val rfc822 = Regex(
    "^(?:[A-Za-z]+,?\\s+)?(\\d{1,2})\\s+([A-Za-z]+)\\s+(\\d{4}|\\d{2})(?:\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?(?:\\s+([A-Za-z]+|[+-]\\d{2}:?\\d{2}))?$",
  )
  private val numericZone = Regex("^([+-])(\\d{2}):?(\\d{2})$")

  fun parse(raw: String?): Long? {
    val s = raw?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() } ?: return null

    iso.matchEntire(s)?.let { m ->
      val g = m.groupValues
      val frac = g[7]
      return epoch(
        g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].toIntOr0(), g[5].toIntOr0(), g[6].toIntOr0(),
        if (frac.isEmpty()) 0 else "${frac}00".take(3).toInt(),
        zoneOffset(g[8]),
      )
    }

    rfc822.matchEntire(s)?.let { m ->
      val g = m.groupValues
      val month = months.indexOf(g[2].take(3).lowercase()) + 1
      if (month == 0) return null
      var year = g[3].toInt()
      if (g[3].length == 2) year += if (year < 50) 2000 else 1900
      return epoch(year, month, g[1].toInt(), g[4].toIntOr0(), g[5].toIntOr0(), g[6].toIntOr0(), 0, zoneOffset(g[7]))
    }

    return null
  }

  private fun String.toIntOr0() = if (isEmpty()) 0 else toInt()

  /** Minutes east of UTC; no zone or an unknown name is UTC, a bad offset null. */
  private fun zoneOffset(zone: String): Int? {
    if (zone.isEmpty()) return 0
    zones[zone.uppercase()]?.let { return it * 60 }
    val m = numericZone.matchEntire(zone) ?: return 0
    val hours = m.groupValues[2].toInt()
    val minutes = m.groupValues[3].toInt()
    if (hours > 23 || minutes > 59) return null
    return (if (m.groupValues[1] == "-") -1 else 1) * (hours * 60 + minutes)
  }

  private fun epoch(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, ms: Int, offset: Int?): Long? {
    if (offset == null || month !in 1..12) return null
    if (day < 1 || day > LocalDate.of(year, month, 1).lengthOfMonth()) return null
    if (hour > 23 || minute > 59 || second > 59) return null
    val seconds = LocalDate.of(year, month, day).atTime(hour, minute, second).toEpochSecond(ZoneOffset.UTC)
    return seconds * 1000 + ms - offset * 60_000L
  }
}
