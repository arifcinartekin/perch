import { and, eq, lt, notExists, notInArray, sql } from 'drizzle-orm';
import { toArticle } from '@perch/core/parser/normalize';
import { searchableText } from '@perch/core/search';
import type { ParsedArticle } from '@perch/core/types';
import type { DB } from '../db';
import { articleStates, articles } from '../db/schema';

// Article storage for the shared, per-feed article table.

/** Keep at least this many of the newest articles per feed regardless of age. */
const KEEP_NEWEST = 200;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Insert new items and refresh the content of existing ones. Read/starred state
 * lives in article_states, so nothing here can reset it. Returns how many
 * items were new.
 */
export function storeArticles(
  db: DB,
  feedId: string,
  parsed: ParsedArticle[],
  now = Date.now(),
): number {
  if (parsed.length === 0) return 0;
  return db.transaction((tx) => {
    let inserted = 0;
    for (const p of parsed) {
      const a = toArticle(p, feedId, now);
      const row = {
        feedId,
        id: a.id,
        guid: a.guid ?? null,
        url: a.url ?? null,
        title: a.title,
        author: a.author ?? null,
        publishedAt: a.publishedAt,
        updatedAt: a.updatedAt ?? null,
        summaryHtml: a.summaryHtml ?? null,
        contentHtml: a.contentHtml ?? null,
        enclosures: a.enclosures,
        fetchedAt: now,
        searchText: searchableText(a),
      };
      const result = tx
        .insert(articles)
        .values(row)
        .onConflictDoUpdate({
          target: [articles.feedId, articles.id],
          set: {
            url: row.url,
            title: row.title,
            author: row.author,
            updatedAt: row.updatedAt,
            summaryHtml: row.summaryHtml,
            contentHtml: row.contentHtml,
            enclosures: row.enclosures,
            searchText: row.searchText,
            // Only move publishedAt if the feed actually provides one.
            publishedAt: sql`coalesce(nullif(${row.publishedAt}, 0), ${articles.publishedAt})`,
          },
        })
        .returning({ fetchedAt: articles.fetchedAt })
        .get();
      // fetchedAt is only set on insert, so it equals `now` for new rows.
      if (result?.fetchedAt === now) inserted++;
    }
    return inserted;
  });
}

/**
 * Drop old articles nobody starred: older than 90 days and outside the newest
 * 200 of the feed. Read state for dropped articles goes with them.
 */
export function pruneFeed(db: DB, feedId: string, now = Date.now()): number {
  const newest = db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.feedId, feedId))
    .orderBy(sql`${articles.publishedAt} desc`)
    .limit(KEEP_NEWEST);

  const starred = db
    .select({ one: sql`1` })
    .from(articleStates)
    .where(
      and(
        eq(articleStates.feedId, articles.feedId),
        eq(articleStates.articleId, articles.id),
        eq(articleStates.starred, true),
      ),
    );

  const removed = db
    .delete(articles)
    .where(
      and(
        eq(articles.feedId, feedId),
        lt(articles.fetchedAt, now - MAX_AGE_MS),
        lt(articles.publishedAt, now - MAX_AGE_MS),
        notInArray(articles.id, newest),
        notExists(starred),
      ),
    )
    .returning({ id: articles.id })
    .all();

  if (removed.length > 0) {
    db.delete(articleStates)
      .where(
        and(
          eq(articleStates.feedId, feedId),
          eq(articleStates.starred, false),
          notExists(
            db
              .select({ one: sql`1` })
              .from(articles)
              .where(
                and(
                  eq(articles.feedId, articleStates.feedId),
                  eq(articles.id, articleStates.articleId),
                ),
              ),
          ),
        ),
      )
      .run();
  }
  return removed.length;
}
