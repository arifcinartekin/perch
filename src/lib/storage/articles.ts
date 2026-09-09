import type { IDBPDatabase } from 'idb';
import type { Article } from '../types';
import { toArticle } from '../parser/normalize';
import type { ParsedArticle } from '../types';
import { getDB, type PerchDB } from './db';

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * Merge freshly parsed articles for a feed into the store. New items are
 * inserted; existing items have their *content* refreshed but their
 * `read` / `starred` / `fetchedAt` preserved.
 */
export async function upsertArticles(
  feedId: string,
  parsed: ParsedArticle[],
  now = Date.now(),
): Promise<UpsertResult> {
  const db = await getDB();
  const tx = db.transaction('articles', 'readwrite');
  let inserted = 0;
  let updated = 0;

  for (const p of parsed) {
    const article = toArticle(p, feedId, now);
    const existing = await tx.store.get(article.id);
    if (!existing) {
      await tx.store.put(article);
      inserted++;
    } else {
      const merged: Article = {
        ...existing,
        title: article.title,
        author: article.author,
        url: article.url,
        summaryHtml: article.summaryHtml,
        contentHtml: article.contentHtml,
        enclosures: article.enclosures,
        updatedAt: article.updatedAt,
        // Only move publishedAt forward if the feed genuinely revised it.
        publishedAt: article.publishedAt || existing.publishedAt,
      };
      await tx.store.put(merged);
      updated++;
    }
  }

  await tx.done;
  return { inserted, updated };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ListQuery {
  /** Restrict to these feed ids. Omit for "all feeds". */
  feedIds?: string[];
  unreadOnly?: boolean;
  starredOnly?: boolean;
  limit?: number;
  /** Pagination cursor from a previous page's last item. */
  before?: { publishedAt: number; id: string };
}

export interface ArticlePage {
  items: Article[];
  /** Cursor for the next page, or null when the list is exhausted. */
  nextCursor: { publishedAt: number; id: string } | null;
}

export async function listArticles(query: ListQuery = {}): Promise<ArticlePage> {
  const db = await getDB();
  const limit = query.limit ?? 50;
  const feedSet = query.feedIds ? new Set(query.feedIds) : null;
  if (feedSet && feedSet.size === 0) return { items: [], nextCursor: null };

  // `by-published` iterated 'prev' yields (publishedAt desc, id desc). The key
  // range trims the bulk of already-seen pages; the manual check below handles
  // ties on publishedAt at the page boundary.
  const range = query.before ? IDBKeyRange.upperBound(query.before.publishedAt) : null;

  const matches = (a: Article) =>
    (!feedSet || feedSet.has(a.feedId)) &&
    (!query.unreadOnly || a.read === 0) &&
    (!query.starredOnly || a.starred === 1);

  const items: Article[] = [];
  let cursor = await db
    .transaction('articles')
    .store.index('by-published')
    .openCursor(range, 'prev');

  while (cursor && items.length < limit) {
    const a = cursor.value;
    const b = query.before;
    const afterBoundary =
      !b || a.publishedAt < b.publishedAt || (a.publishedAt === b.publishedAt && a.id < b.id);
    if (afterBoundary && matches(a)) items.push(a);
    cursor = await cursor.continue();
  }

  const last = items[items.length - 1];
  const nextCursor =
    items.length === limit && last ? { publishedAt: last.publishedAt, id: last.id } : null;
  return { items, nextCursor };
}

export async function getArticle(id: string): Promise<Article | undefined> {
  return (await getDB()).get('articles', id);
}

// ---------------------------------------------------------------------------
// Read / starred state
// ---------------------------------------------------------------------------

export async function setRead(ids: string[], read: boolean): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('articles', 'readwrite');
  const value: 0 | 1 = read ? 1 : 0;
  for (const id of ids) {
    const a = await tx.store.get(id);
    if (a && a.read !== value) await tx.store.put({ ...a, read: value });
  }
  await tx.done;
}

export async function setStarred(id: string, starred: boolean): Promise<void> {
  const db = await getDB();
  const a = await db.get('articles', id);
  if (a) await db.put('articles', { ...a, starred: starred ? 1 : 0 });
}

/** Mark every article of the given feeds (or all feeds) as read. */
export async function markAllRead(feedIds?: string[]): Promise<void> {
  const db = await getDB();
  const feedSet = feedIds ? new Set(feedIds) : null;
  const tx = db.transaction('articles', 'readwrite');
  let cursor = await tx.store.index('by-read').openCursor(0);
  while (cursor) {
    if (!feedSet || feedSet.has(cursor.value.feedId)) {
      await cursor.update({ ...cursor.value, read: 1 });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** Unread count per feed id. */
export async function unreadCountsByFeed(): Promise<Record<string, number>> {
  const db = await getDB();
  const counts: Record<string, number> = {};
  let cursor = await db.transaction('articles').store.index('by-read').openCursor(0);
  while (cursor) {
    counts[cursor.value.feedId] = (counts[cursor.value.feedId] ?? 0) + 1;
    cursor = await cursor.continue();
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Pruning / deletion
// ---------------------------------------------------------------------------

export interface PruneOptions {
  /** Keep at least this many newest items per feed regardless of age. */
  keep?: number;
  /** Drop read items older than this many days (unless within `keep`). */
  maxAgeDays?: number;
}

export async function pruneFeed(feedId: string, options: PruneOptions = {}): Promise<number> {
  const keep = options.keep ?? 300;
  const maxAgeMs = (options.maxAgeDays ?? 60) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;

  const db = await getDB();
  const tx = db.transaction('articles', 'readwrite');
  const index = tx.store.index('by-feed-published');
  // Newest first for this feed.
  let cursor = await index.openCursor(
    IDBKeyRange.bound([feedId, -Infinity], [feedId, Infinity]),
    'prev',
  );
  let seen = 0;
  let removed = 0;
  while (cursor) {
    seen++;
    const a = cursor.value;
    const tooOld = a.publishedAt < cutoff;
    if (seen > keep && tooOld && a.read === 1 && a.starred === 0) {
      await cursor.delete();
      removed++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

export async function deleteArticlesForFeed(feedId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['articles', 'fulltext'], 'readwrite');
  const idx = tx.objectStore('articles').index('by-feed');
  let cursor = await idx.openCursor(feedId);
  const fulltext = tx.objectStore('fulltext');
  while (cursor) {
    await fulltext.delete(cursor.value.id).catch(() => undefined);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function countArticles(db?: IDBPDatabase<PerchDB>): Promise<number> {
  return (db ?? (await getDB())).count('articles');
}
