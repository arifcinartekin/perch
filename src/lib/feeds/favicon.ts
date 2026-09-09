import { bareHost } from '../util/url';

// Favicons come straight from the site the feed belongs to — never a third-party
// favicon service. When we can't load one, the UI falls back to a letter tile.

export function faviconUrl(feed: {
  siteUrl?: string;
  url: string;
  iconUrl?: string;
}): string | null {
  if (feed.iconUrl) return feed.iconUrl;
  try {
    const base = new URL(feed.siteUrl || feed.url);
    return `${base.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

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
