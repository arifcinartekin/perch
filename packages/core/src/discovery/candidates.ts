import { isHttpUrl } from '../url';

// Well-known feed locations to probe when a page exposes no <link rel=alternate>
// tags. Kept short on purpose — this is a courtesy scan, not a crawler.

const SAME_ORIGIN_PATHS = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss/',
  '/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/feed.xml',
  '/rss.html',
  '/atom',
  '/feed/atom',
  '/?feed=rss2', // WordPress
  '/feeds/posts/default', // Blogger
  '/blog/feed',
  '/blog/rss.xml',
  '/comments/feed',
];

const CROSS_ORIGIN_SUBDOMAINS = ['rss', 'feeds', 'feed'];

export const MAX_CANDIDATES = 20;

export interface CandidateOptions {
  /**
   * Include a few cross-origin subdomain guesses (rss.example.com, …). Only do
   * this when the all-sites host permission is granted — otherwise the fetches
   * would fail anyway.
   */
  includeCrossOrigin?: boolean;
}

/** Build a bounded, de-duplicated list of URLs to probe for `pageUrl`. */
export function buildCandidates(pageUrl: string, options: CandidateOptions = {}): string[] {
  if (!isHttpUrl(pageUrl)) return [];
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string) => {
    if (out.length >= MAX_CANDIDATES) return;
    const normalised = url.replace(/#.*$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      out.push(normalised);
    }
  };

  for (const path of SAME_ORIGIN_PATHS) {
    push(new URL(path, base.origin).toString());
  }

  // If the page sits under a path prefix (e.g. /blog/), also try <prefix>/feed.
  const firstSegment = base.pathname.split('/').filter(Boolean)[0];
  if (firstSegment && !firstSegment.includes('.')) {
    push(new URL(`/${firstSegment}/feed`, base.origin).toString());
    push(new URL(`/${firstSegment}/rss.xml`, base.origin).toString());
  }

  if (options.includeCrossOrigin) {
    const host = base.hostname.replace(/^www\./, '');
    for (const sub of CROSS_ORIGIN_SUBDOMAINS) {
      push(`${base.protocol}//${sub}.${host}/`);
    }
    push(`${base.protocol}//blog.${host}/feed`);
  }

  return out.slice(0, MAX_CANDIDATES);
}
