import { Readability } from '@mozilla/readability';
import { and, eq } from 'drizzle-orm';
import { parseHTML } from 'linkedom';
import type { FullText } from '@perch/core/types';
import type { DB } from '../db';
import { fulltextCache } from '../db/schema';
import { describeError } from '../feeds/fetcher';
import { readTextLimited, type SafeFetch } from '../lib/safe-fetch';

// Server-side full text for the web reader and the app: fetch the article page
// through the SSRF guard and run Readability on it. Cached per article.

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export type ExtractOutcome =
  | { ok: true; fullText: FullText }
  | { ok: false; reason: 'fetch-failed' | 'extract-failed'; detail?: string };

export async function fullTextFor(
  db: DB,
  fetch: SafeFetch,
  article: { feedId: string; id: string; url: string },
  force = false,
): Promise<ExtractOutcome> {
  const where = and(
    eq(fulltextCache.feedId, article.feedId),
    eq(fulltextCache.articleId, article.id),
  );
  if (!force) {
    const cached = db.select().from(fulltextCache).where(where).get();
    if (cached) return { ok: true, fullText: toFullText(cached) };
  }

  let html: string;
  try {
    const res = await fetch(article.url, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, reason: 'fetch-failed', detail: `HTTP ${res.status}` };
    }
    html = await readTextLimited(res, MAX_PAGE_BYTES);
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', detail: describeError(err) };
  }

  let parsed: ReturnType<Readability['parse']>;
  try {
    const { document } = parseHTML(html);
    parsed = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], {
      charThreshold: 200,
    }).parse();
  } catch (err) {
    return { ok: false, reason: 'extract-failed', detail: (err as Error).message };
  }
  if (!parsed?.content) return { ok: false, reason: 'extract-failed' };

  const row = {
    feedId: article.feedId,
    articleId: article.id,
    html: parsed.content,
    title: parsed.title ?? null,
    byline: parsed.byline ?? null,
    excerpt: parsed.excerpt ?? null,
    extractedAt: Date.now(),
  };
  db.insert(fulltextCache)
    .values(row)
    .onConflictDoUpdate({ target: [fulltextCache.feedId, fulltextCache.articleId], set: row })
    .run();
  return { ok: true, fullText: toFullText(row) };
}

function toFullText(r: typeof fulltextCache.$inferSelect): FullText {
  return {
    articleId: r.articleId,
    html: r.html,
    title: r.title ?? undefined,
    byline: r.byline ?? undefined,
    excerpt: r.excerpt ?? undefined,
    extractedAt: r.extractedAt,
  };
}
