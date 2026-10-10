import { bareHost } from './url';

// No favicons are fetched anywhere: loading one would tell the site that you
// follow it. Feeds show their initial on a coloured tile instead.

/** Deterministic pastel colour for a feed's letter-tile fallback. */
export function letterTile(feed: { title?: string; customTitle?: string; url: string }): {
  letter: string;
  bg: string;
} {
  const label = (feed.customTitle || feed.title || bareHost(feed.url) || '?').trim();
  const letter = (label[0] || '?').toUpperCase();
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { letter, bg: `hsl(${hue} 55% 45%)` };
}
