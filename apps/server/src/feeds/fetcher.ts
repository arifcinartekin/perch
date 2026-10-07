import { eq } from 'drizzle-orm';
import { parseFeed } from '@perch/core/parser';
import type { ParsedFeed } from '@perch/core/types';
import type { DB } from '../db';
import { feeds } from '../db/schema';
import { readTextLimited, type SafeFetch } from '../lib/safe-fetch';
import { pruneFeed, storeArticles } from './store';

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

export type FeedDocument =
  | { status: 'not-modified' }
  | {
      status: 'ok';
      parsed: ParsedFeed;
      etag?: string;
      lastModified?: string;
    };

export class FeedHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    /** Seconds the server asked us to wait (429 / 503). */
    readonly retryAfter?: number,
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    this.name = 'FeedHttpError';
  }
}

/** Fetch and parse one feed, using conditional-GET validators when we have them. */
export async function fetchFeedDocument(
  fetch: SafeFetch,
  url: string,
  validators: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FeedDocument> {
  const headers: Record<string, string> = { accept: ACCEPT };
  if (validators.etag) headers['if-none-match'] = validators.etag;
  if (validators.lastModified) headers['if-modified-since'] = validators.lastModified;

  const res = await fetch(url, { headers });
  if (res.status === 304) {
    await res.body?.cancel();
    return { status: 'not-modified' };
  }
  if (!res.ok) {
    await res.body?.cancel();
    const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
    throw new FeedHttpError(
      res.status,
      res.statusText,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  const body = await readTextLimited(res, MAX_FEED_BYTES);
  return {
    status: 'ok',
    parsed: parseFeed(body, res.headers.get('content-type') ?? undefined, url),
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
  };
}

export interface RefreshResult {
  ok: boolean;
  notModified?: boolean;
  inserted?: number;
  error?: string;
}

/** A readable reason, unwrapping undici's generic "fetch failed". */
export function describeError(err: unknown): string {
  const e = err as Error & { cause?: Error & { code?: string } };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'Request timed out';
  if (e.message === 'fetch failed' && e.cause) {
    if (e.cause.name === 'BlockedAddressError') return e.cause.message;
    return e.cause.code ? `${e.cause.code}: ${e.cause.message}` : e.cause.message;
  }
  return e.message || String(err);
}

const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** When to try a feed again: the interval ±10%, doubling per consecutive failure. */
export function nextFetchTime(
  now: number,
  intervalMin: number,
  errorCount: number,
  retryAfterSec?: number,
  random = Math.random,
): number {
  const base = intervalMin * 60_000;
  if (errorCount === 0) return now + Math.round(base * (0.9 + random() * 0.2));
  const backoff = Math.min(base * 2 ** Math.min(errorCount - 1, 10), MAX_BACKOFF_MS);
  return now + Math.max(backoff, (retryAfterSec ?? 0) * 1000);
}

type FeedRow = typeof feeds.$inferSelect;

/** Refresh a feed row in place: fetch, store articles, prune, reschedule. */
export async function refreshFeed(
  db: DB,
  fetch: SafeFetch,
  feed: FeedRow,
  intervalMin: number,
  now = () => Date.now(),
): Promise<RefreshResult> {
  try {
    const doc = await fetchFeedDocument(fetch, feed.url, feed);
    const at = now();
    if (doc.status === 'not-modified') {
      db.update(feeds)
        .set({
          lastFetchedAt: at,
          lastError: null,
          errorCount: 0,
          nextFetchAt: nextFetchTime(at, intervalMin, 0),
        })
        .where(eq(feeds.id, feed.id))
        .run();
      return { ok: true, notModified: true };
    }

    const inserted = storeArticles(db, feed.id, doc.parsed.articles, at);
    pruneFeed(db, feed.id, at);
    db.update(feeds)
      .set({
        title: doc.parsed.title || feed.title,
        siteUrl: doc.parsed.siteUrl ?? feed.siteUrl,
        iconUrl: doc.parsed.iconUrl ?? feed.iconUrl,
        etag: doc.etag ?? null,
        lastModified: doc.lastModified ?? null,
        lastFetchedAt: at,
        lastError: null,
        errorCount: 0,
        nextFetchAt: nextFetchTime(at, intervalMin, 0),
      })
      .where(eq(feeds.id, feed.id))
      .run();
    return { ok: true, inserted };
  } catch (err) {
    const at = now();
    const message = describeError(err);
    const errorCount = feed.errorCount + 1;
    db.update(feeds)
      .set({
        lastFetchedAt: at,
        lastError: message,
        errorCount,
        nextFetchAt: nextFetchTime(
          at,
          intervalMin,
          errorCount,
          err instanceof FeedHttpError ? err.retryAfter : undefined,
        ),
      })
      .where(eq(feeds.id, feed.id))
      .run();
    return { ok: false, error: message };
  }
}
