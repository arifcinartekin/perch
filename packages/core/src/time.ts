// Compact relative time ("3h", "2d", "Apr 4") using the platform Intl APIs —
// no date library.

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
const sameYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const withYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

export function relativeTime(epochMs: number, now = Date.now()): string {
  const diff = epochMs - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (abs < min) return 'now';
  if (abs < hour) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), 'day');

  const date = new Date(epochMs);
  const thisYear = new Date(now).getFullYear();
  return (date.getFullYear() === thisYear ? sameYear : withYear).format(date);
}

export function fullTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
