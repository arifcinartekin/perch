import type { DiscoveredFeed } from '../types';
import { getFeeds } from '../storage/feeds';
import { normalizeFeedUrl } from '../util/url';
import { buildCandidates } from './candidates';
import { findLinkTagFeeds } from './linktags';
import { probeCandidates } from './probe';

// Orchestrates discovery for a tab: try the page's <link> tags first; only if
// none are found, fall back to bounded probing of well-known paths.

export interface DiscoveryOutcome {
  pageUrl: string;
  pageTitle?: string;
  iconHref?: string;
  feeds: DiscoveredFeed[];
}

export interface DiscoverOptions {
  /** All-sites permission is granted → probing may include cross-origin guesses. */
  crossOrigin?: boolean;
  /** Skip the fallback probe entirely (e.g. very cheap popup scan). */
  linkTagsOnly?: boolean;
}

export async function discoverForTab(
  tabId: number,
  pageUrl: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryOutcome> {
  const linkResult = await findLinkTagFeeds(tabId);
  const effectivePageUrl = linkResult?.pageUrl ?? pageUrl;

  const found = new Map<string, DiscoveredFeed>();
  const add = (url: string, via: DiscoveredFeed['via'], title?: string) => {
    const norm = normalizeFeedUrl(url);
    if (!/^https?:/i.test(norm)) return;
    if (!found.has(norm)) found.set(norm, { url: norm, title, via, alreadyAdded: false });
  };

  for (const f of linkResult?.feeds ?? []) {
    add(f.href, 'link-tag', f.title);
  }

  if (found.size === 0 && !options.linkTagsOnly) {
    const candidates = buildCandidates(effectivePageUrl, {
      includeCrossOrigin: options.crossOrigin,
    });
    const hits = await probeCandidates(candidates);
    for (const hit of hits) add(hit.url, 'probe');
  }

  // Flag feeds that are already subscribed.
  const subscribed = new Set((await getFeeds()).map((f) => normalizeFeedUrl(f.url)));
  const feeds = [...found.values()].map((f) => ({
    ...f,
    alreadyAdded: subscribed.has(normalizeFeedUrl(f.url)),
  }));

  // Link-tag results first, then probes; stable otherwise.
  feeds.sort((a, b) => (a.via === b.via ? 0 : a.via === 'link-tag' ? -1 : 1));

  return {
    pageUrl: effectivePageUrl,
    pageTitle: linkResult?.pageTitle,
    iconHref: linkResult?.iconHref,
    feeds,
  };
}
