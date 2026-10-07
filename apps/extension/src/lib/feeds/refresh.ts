import { parseFeed } from '@perch/core/parser';
import { hasHostPermission } from '../permissions/host';
import { pruneFeed, upsertArticles } from '../storage/articles';
import { getFeeds, updateFeed } from '../storage/feeds';
import type { Feed } from '@perch/core/types';

// Background feed refresh. Runs from the service worker on an alarm and on
// demand from the reader's "Refresh" button. Never touches the DOM.

const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 4;

export interface FeedRefreshResult {
  feedId: string;
  ok: boolean;
  notModified?: boolean;
  inserted?: number;
  updated?: number;
  error?: string;
}

export async function refreshFeed(feed: Feed): Promise<FeedRefreshResult> {
  // We only fetch origins the user has granted access to.
  if (!(await hasHostPermission(feed.url))) {
    await updateFeed(feed.id, {
      needsPermission: true,
      lastError: 'Access to this site has not been granted',
    });
    return { feedId: feed.id, ok: false, error: 'needs-permission' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept:
        'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.5',
    };
    if (feed.etag) headers['If-None-Match'] = feed.etag;
    if (feed.lastModified) headers['If-Modified-Since'] = feed.lastModified;

    const res = await fetch(feed.url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-cache',
      signal: controller.signal,
      headers,
    });

    if (res.status === 304) {
      await updateFeed(feed.id, {
        lastFetchedAt: Date.now(),
        lastError: undefined,
        needsPermission: false,
      });
      return { feedId: feed.id, ok: true, notModified: true };
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const body = await res.text();
    const parsed = parseFeed(body, res.headers.get('content-type') ?? undefined, feed.url);

    const { inserted, updated } = await upsertArticles(feed.id, parsed.articles);
    await pruneFeed(feed.id);

    await updateFeed(feed.id, {
      title: feed.customTitle ? feed.title : parsed.title || feed.title,
      siteUrl: parsed.siteUrl ?? feed.siteUrl,
      iconUrl: parsed.iconUrl ?? feed.iconUrl,
      lastFetchedAt: Date.now(),
      lastError: undefined,
      needsPermission: false,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    });

    return { feedId: feed.id, ok: true, inserted, updated };
  } catch (err) {
    const message =
      (err as Error).name === 'AbortError' ? 'Request timed out' : (err as Error).message;
    await updateFeed(feed.id, { lastFetchedAt: Date.now(), lastError: message });
    return { feedId: feed.id, ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export interface RefreshSummary {
  refreshed: number;
  failed: number;
  results: FeedRefreshResult[];
}

/** Refresh every feed (or a subset) with bounded concurrency. */
export async function refreshFeeds(
  feedIds?: string[],
  concurrency = DEFAULT_CONCURRENCY,
): Promise<RefreshSummary> {
  const all = await getFeeds();
  const targets = feedIds ? all.filter((f) => feedIds.includes(f.id)) : all;

  const results: FeedRefreshResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const feed = targets[cursor++]!;
      results.push(await refreshFeed(feed));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  return {
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
