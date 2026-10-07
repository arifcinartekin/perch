// Feed date parsing. Feeds use RFC 822 (RSS), RFC 3339 / ISO 8601 (Atom, JSON
// Feed), and a long tail of near-misses. `Date.parse` handles most of them; we
// add a couple of fallbacks and always return a finite epoch-ms number or null.

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Parse a feed date string to epoch ms, or null if it can't be understood. */
export function parseDate(input: string | undefined | null): number | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const native = Date.parse(raw);
  if (Number.isFinite(native)) return native;

  // RFC 822-ish without a recognised timezone, e.g. "Tue, 05 Jun 2018 10:00:00 EST".
  // Retry with the trailing timezone token dropped (treated as local).
  const tzStripped = raw.replace(/\s+[A-Z]{2,5}$/, '');
  if (tzStripped !== raw) {
    const retry = Date.parse(tzStripped);
    if (Number.isFinite(retry)) return retry;
  }

  // "DD Mon YYYY[ HH:MM[:SS]]" with no weekday.
  const m = raw.match(
    /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [, d, mon, y, hh, mm, ss] = m;
    const monthKey = mon?.toLowerCase() ?? '';
    if (monthKey in MONTHS && d && y) {
      const ms = Date.UTC(
        Number(y),
        MONTHS[monthKey]!,
        Number(d),
        hh ? Number(hh) : 0,
        mm ? Number(mm) : 0,
        ss ? Number(ss) : 0,
      );
      if (Number.isFinite(ms)) return ms;
    }
  }

  return null;
}

/**
 * Resolve an article's timestamp from its candidate fields, never returning a
 * date in the far future (clock-skewed feeds are common). Falls back to `now`.
 */
export function resolvePublishedAt(
  candidates: (string | undefined | null)[],
  now = Date.now(),
): number {
  const maxFuture = now + 24 * 60 * 60 * 1000; // tolerate 1 day of skew
  for (const c of candidates) {
    const ms = parseDate(c);
    if (ms != null && ms <= maxFuture) return ms;
  }
  return now;
}
