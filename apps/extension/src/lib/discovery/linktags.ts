import { browser } from 'wxt/browser';

// Primary discovery method: read the page's own <link rel="alternate"> feed
// hints. This is cheap and accurate. The collector function is injected into the
// page with `scripting.executeScript`, so it must be fully self-contained.

export interface LinkTagFeed {
  href: string;
  type: string;
  title?: string;
}

export interface LinkTagResult {
  pageUrl: string;
  pageTitle: string;
  iconHref?: string;
  feeds: LinkTagFeed[];
}

// NOTE: injected into the target page — no imports, no outer-scope references.
function collectLinkTags(): LinkTagResult {
  const FEED_TYPES = [
    'application/rss+xml',
    'application/atom+xml',
    'application/feed+json',
    'application/json',
    'text/xml',
    'application/xml',
  ];
  const abs = (href: string): string | null => {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return null;
    }
  };

  const feeds: LinkTagFeed[] = [];
  const links = Array.from(document.querySelectorAll('link[rel~="alternate"], link[rel="feed"]'));
  for (const link of links) {
    const type = (link.getAttribute('type') || '').toLowerCase().trim();
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    const href = link.getAttribute('href');
    if (!href) continue;
    const isFeedType = FEED_TYPES.includes(type);
    const isFeedRel = rel.split(/\s+/).includes('feed');
    // Plain application/json only counts when the rel explicitly says "feed".
    if (!isFeedType && !isFeedRel) continue;
    if (type === 'application/json' && !isFeedRel) continue;
    const resolved = abs(href);
    if (!resolved) continue;
    if (feeds.some((f) => f.href === resolved)) continue;
    feeds.push({
      href: resolved,
      type: type || (isFeedRel ? 'feed' : 'unknown'),
      title: link.getAttribute('title') || undefined,
    });
  }

  const iconEl = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
  );
  const iconHref = iconEl?.getAttribute('href') ? abs(iconEl.getAttribute('href')!) : null;

  return {
    pageUrl: location.href,
    pageTitle: document.title || location.hostname,
    iconHref: iconHref || undefined,
    feeds,
  };
}

/**
 * Run the collector in the given tab. Requires either `activeTab` (popup path)
 * or a granted host permission for the tab's origin (auto-scan path).
 */
export async function findLinkTagFeeds(tabId: number): Promise<LinkTagResult | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: collectLinkTags,
    });
    const first = results?.[0]?.result as LinkTagResult | undefined;
    return first ?? null;
  } catch {
    // No permission for this tab, or it's a restricted page (chrome://, store, …).
    return null;
  }
}
