// Feed date parsing: RFC 3339 / ISO 8601 (Atom, JSON Feed, Dublin Core) and
// RFC 822 (RSS) with the usual variations found in the wild. Written out by
// hand rather than left to Date.parse, which differs between browsers and
// reads zoneless dates in the device's time zone: an item keyed on its date
// must get the same id everywhere. FeedDates.swift and FeedDates.kt follow
// the same rules, and tests/fixtures/dates.json pins all three.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** RFC 822 zone names, in hours from UTC. Any other name counts as UTC. */
const ZONES: Record<string, number> = {
  GMT: 0,
  UT: 0,
  UTC: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
};

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*([Zz]|[+-]\d{2}:?\d{2})?$/;
const RFC822 =
  /^(?:[A-Za-z]+,?\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([A-Za-z]+|[+-]\d{2}:?\d{2}))?$/;

/** Minutes east of UTC; no zone or an unknown name is UTC, a bad offset null. */
function zoneOffset(zone: string | undefined): number | null {
  if (!zone) return 0;
  const named = ZONES[zone.toUpperCase()];
  if (named !== undefined) return named * 60;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return 0;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Epoch ms for a UTC wall time shifted by `offset` minutes, or null when out of range. */
function epoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  offset: number | null,
): number | null {
  if (offset === null || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60_000;
}

/** Parse a feed date string to epoch ms, or null if it can't be understood. */
export function parseDate(input: string | undefined | null): number | null {
  const s = input?.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  const iso = ISO.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, sec, frac, zone] = iso;
    return epoch(
      Number(y),
      Number(mo),
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(sec ?? 0),
      frac ? Number(`${frac}00`.slice(0, 3)) : 0,
      zoneOffset(zone),
    );
  }

  const rfc = RFC822.exec(s);
  if (rfc) {
    const [, d, mon, y, h, mi, sec, zone] = rfc;
    const month = MONTHS.indexOf(mon!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    let year = Number(y);
    if (y!.length === 2) year += year < 50 ? 2000 : 1900;
    return epoch(
      year,
      month,
      Number(d),
      Number(h ?? 0),
      Number(mi ?? 0),
      Number(sec ?? 0),
      0,
      zoneOffset(zone),
    );
  }

  return null;
}

/**
 * The first parseable candidate, never a date in the far future
 * (clock-skewed feeds are common). Undefined when the item has no usable date.
 */
export function findPublishedAt(
  candidates: (string | undefined | null)[],
  now = Date.now(),
): number | undefined {
  const maxFuture = now + 24 * 60 * 60 * 1000; // tolerate 1 day of skew
  for (const c of candidates) {
    const ms = parseDate(c);
    if (ms != null && ms <= maxFuture) return ms;
  }
  return undefined;
}

/** Like findPublishedAt, falling back to `now`. */
export function resolvePublishedAt(
  candidates: (string | undefined | null)[],
  now = Date.now(),
): number {
  return findPublishedAt(candidates, now) ?? now;
}
