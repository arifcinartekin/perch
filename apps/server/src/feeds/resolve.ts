import { eq } from 'drizzle-orm';
import { buildCandidates } from '@perch/core/discovery/candidates';
import { feedLinksFromHtml } from '@perch/core/discovery/html';
import { probeCandidates } from '@perch/core/discovery/probe';
import { feedIdFor } from '@perch/core/feeds';
import { parseFeed } from '@perch/core/parser';
import { isHttpUrl, normalizeFeedUrl } from '@perch/core/url';
import type { DB } from '../db';
import { feeds } from '../db/schema';
import { HttpError } from '../http';
import { readTextLimited, type SafeFetch } from '../lib/safe-fetch';
import { describeError, MAX_FEED_BYTES, nextFetchTime } from './fetcher';
import { storeArticles } from './store';

// Turn whatever the user pasted — a feed URL or just a site — into a feed row,
// fetching it once so the subscription starts with articles.

type FeedRow = typeof feeds.$inferSelect;

export async function resolveFeed(
  db: DB,
  fetch: SafeFetch,
  input: string,
  intervalMin: number,
): Promise<FeedRow> {
  const url = input.trim();
  if (!isHttpUrl(url)) throw new HttpError(400, 'invalid-url', 'Enter an http(s) URL');

  const known = findFeed(db, url);
  if (known) return known;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        accept:
          'application/rss+xml, application/atom+xml, application/feed+json, text/html;q=0.9, */*;q=0.5',
      },
    });
  } catch (err) {
    throw new HttpError(422, 'fetch-failed', `Couldn't load ${url}: ${describeError(err)}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(422, 'fetch-failed', `Couldn't load ${url}: HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? undefined;
  const body = await readTextLimited(res, MAX_FEED_BYTES);

  // 1. The URL is a feed.
  try {
    return createFeed(db, url, body, contentType, intervalMin);
  } catch {
    // Not a feed; look for one below.
  }

  // 2. The page advertises feeds in its <head>.
  const pageUrl = res.url || url;
  const candidates =
    /html/i.test(contentType ?? '') || /<html/i.test(body.slice(0, 2000))
      ? feedLinksFromHtml(body, pageUrl).map((l) => l.url)
      : [];

  // 3. Well-known paths, as the extension's popup does.
  if (candidates.length === 0) {
    const hits = await probeCandidates(buildCandidates(pageUrl), {
      fetchImpl: fetch as unknown as typeof globalThis.fetch,
      maxHits: 1,
    });
    candidates.push(...hits.map((h) => h.url));
  }

  for (const candidate of candidates.slice(0, 3)) {
    const existing = findFeed(db, candidate);
    if (existing) return existing;
    try {
      const r = await fetch(candidate);
      if (!r.ok) {
        await r.body?.cancel();
        continue;
      }
      const text = await readTextLimited(r, MAX_FEED_BYTES);
      return createFeed(
        db,
        candidate,
        text,
        r.headers.get('content-type') ?? undefined,
        intervalMin,
      );
    } catch {
      // Try the next candidate.
    }
  }

  throw new HttpError(422, 'no-feed-found', `No RSS, Atom or JSON feed found at ${url}`);
}

function findFeed(db: DB, url: string): FeedRow | undefined {
  return db
    .select()
    .from(feeds)
    .where(eq(feeds.id, feedIdFor(url)))
    .get();
}

/** Parse `body` as the feed at `url` and store it. Throws if it isn't a feed. */
function createFeed(
  db: DB,
  url: string,
  body: string,
  contentType: string | undefined,
  intervalMin: number,
): FeedRow {
  const parsed = parseFeed(body, contentType, url);
  const now = Date.now();
  const row = db
    .insert(feeds)
    .values({
      id: feedIdFor(url),
      url: normalizeFeedUrl(url),
      title: parsed.title,
      siteUrl: parsed.siteUrl ?? null,
      iconUrl: parsed.iconUrl ?? null,
      lastFetchedAt: now,
      nextFetchAt: nextFetchTime(now, intervalMin, 0),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (!row) return findFeed(db, url)!;
  storeArticles(db, row.id, parsed.articles, now);
  return row;
}

/** A feed row for an imported URL, fetched later by the worker. */
export function ensureFeed(db: DB, url: string, title?: string): FeedRow {
  const existing = findFeed(db, url);
  if (existing) return existing;
  return (
    db
      .insert(feeds)
      .values({
        id: feedIdFor(url),
        url: normalizeFeedUrl(url),
        title: title ?? '',
        nextFetchAt: 0,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .returning()
      .get() ?? findFeed(db, url)!
  );
}
