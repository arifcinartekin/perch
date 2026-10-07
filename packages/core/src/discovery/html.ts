import { resolveUrl } from '../url';

// <link rel="alternate"> discovery from raw HTML, for places without a DOM (the
// server). The extension reads the live page instead; both accept the same
// types so a page yields the same feeds either way.

export interface HtmlFeedLink {
  url: string;
  type: string;
  title?: string;
}

const FEED_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/json',
  'text/xml',
  'application/xml',
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]!);

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Feed links a page advertises in its markup, resolved against `pageUrl` (or its <base>). */
export function feedLinksFromHtml(html: string, pageUrl: string): HtmlFeedLink[] {
  // Only the head matters, and capping keeps a huge page from costing much.
  const head = html.slice(0, 200_000);
  const baseHref = /<base\s[^>]*>/i.exec(head)?.[0];
  const base = (baseHref && resolveUrl(attributes(baseHref).href, pageUrl)) || pageUrl;

  const feeds: HtmlFeedLink[] = [];
  for (const [tag] of head.matchAll(/<link\s[^>]*>/gi)) {
    const a = attributes(tag);
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    const type = (a.type ?? '').toLowerCase().trim();
    const isFeedRel = rel.includes('feed');
    if (!rel.includes('alternate') && !isFeedRel) continue;
    if (!FEED_TYPES.has(type) && !isFeedRel) continue;
    // Plain application/json only counts when the rel explicitly says "feed".
    if (type === 'application/json' && !isFeedRel) continue;
    const url = resolveUrl(a.href, base);
    if (!url || feeds.some((f) => f.url === url)) continue;
    feeds.push({ url, type: type || 'feed', title: a.title || undefined });
  }
  return feeds;
}
