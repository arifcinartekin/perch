import { and, count, eq, max, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  ArticlesResponse,
  CountsResponse,
  LibraryResponse,
  OpmlImportResponse,
  ServerFeed,
  SyncedSettings,
} from '@perch/core/api';
import { buildOpml, parseOpml } from '@perch/core/opml';
import { searchTerms } from '@perch/core/search';
import { UNCATEGORIZED_ID, type Article, type Category, type Feed } from '@perch/core/types';
import type { DB } from '../db';
import {
  articleStates,
  articles,
  categories,
  feeds,
  subscriptions,
  userSettings,
} from '../db/schema';
import { badRequest, jsonBody, notFound, str, type AppContext, type Env } from '../http';
import { randomToken } from '../lib/crypto';
import { requireUser } from '../auth/sessions';
import { ensureFeed, resolveFeed } from '../feeds/resolve';

// The personal-mode reader API: what the web reader and native clients use to
// list feeds, page through articles and mark them read.

const UNCATEGORIZED: Category = { id: UNCATEGORIZED_ID, name: 'Uncategorized', order: 1000 };
const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

export function readerRoutes(ctx: AppContext) {
  const { db, config } = ctx;
  const app = new Hono<Env>();
  app.use(requireUser(ctx));

  // -------------------------------------------------------------------------
  // Library
  // -------------------------------------------------------------------------

  app.get('/library', (c) => {
    const userId = c.get('user').id;
    return c.json<LibraryResponse>({
      feeds: listFeeds(db, userId),
      categories: listCategories(db, userId),
    });
  });

  app.post('/feeds', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c);
    const feed = await resolveFeed(db, ctx.fetch, str(body, 'url'), config.fetchIntervalMin);
    const title = str(body, 'title', { max: 200, optional: true }).trim();
    db.insert(subscriptions)
      .values({
        userId,
        feedId: feed.id,
        categoryId: validCategory(db, userId, str(body, 'categoryId', { max: 64, optional: true })),
        customTitle: title && title !== feed.title ? title : null,
        addedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    return c.json({ feed: listFeeds(db, userId, feed.id)[0]! });
  });

  app.patch('/feeds/:id', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c);
    const patch: Partial<typeof subscriptions.$inferInsert> = {};
    if ('categoryId' in body) {
      patch.categoryId = validCategory(db, userId, str(body, 'categoryId', { max: 64 }));
    }
    if ('customTitle' in body) {
      patch.customTitle =
        body.customTitle == null ? null : str(body, 'customTitle', { max: 200 }).trim() || null;
    }
    if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
    const updated = db
      .update(subscriptions)
      .set(patch)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, c.req.param('id'))))
      .returning({ feedId: subscriptions.feedId })
      .get();
    if (!updated) throw notFound('No such subscription');
    return c.json({ feed: listFeeds(db, userId, updated.feedId)[0]! });
  });

  app.delete('/feeds/:id', (c) => {
    const userId = c.get('user').id;
    const feedId = c.req.param('id');
    db.transaction((tx) => {
      tx.delete(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
        .run();
      // Starred articles outlive the subscription; everything else goes.
      tx.delete(articleStates)
        .where(
          and(
            eq(articleStates.userId, userId),
            eq(articleStates.feedId, feedId),
            eq(articleStates.starred, false),
          ),
        )
        .run();
    });
    return c.json({ ok: true });
  });

  app.post('/categories', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c);
    const name = str(body, 'name', { max: 100 }).trim() || 'New category';
    const existing = listCategories(db, userId).find(
      (cat) => cat.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return c.json({ category: existing });

    const top = db
      .select({ order: max(categories.order) })
      .from(categories)
      .where(and(eq(categories.userId, userId), sql`${categories.order} < 1000`))
      .get();
    const category: Category = {
      id: str(body, 'id', { max: 64, optional: true }) || randomToken(8),
      name,
      order: Math.max(0, top?.order ?? 0) + 10,
    };
    db.insert(categories)
      .values({ userId, ...category })
      .run();
    return c.json({ category });
  });

  app.patch('/categories/:id', async (c) => {
    const userId = c.get('user').id;
    const id = c.req.param('id');
    const body = await jsonBody(c);
    const current = listCategories(db, userId).find((cat) => cat.id === id);
    if (!current) throw notFound('No such category');

    const next: Category = { ...current };
    if ('name' in body && id !== UNCATEGORIZED_ID) {
      next.name = str(body, 'name', { max: 100 }).trim() || current.name;
    }
    if ('order' in body) {
      if (!Number.isInteger(body.order)) throw badRequest('"order" must be an integer');
      next.order = body.order as number;
    }
    if ('collapsed' in body) next.collapsed = Boolean(body.collapsed);

    // "Uncategorized" is implicit until the user changes it.
    db.insert(categories)
      .values({ userId, ...next, collapsed: next.collapsed ?? false })
      .onConflictDoUpdate({
        target: [categories.userId, categories.id],
        set: { name: next.name, order: next.order, collapsed: next.collapsed ?? false },
      })
      .run();
    return c.json({ category: next });
  });

  app.delete('/categories/:id', (c) => {
    const userId = c.get('user').id;
    const id = c.req.param('id');
    if (id === UNCATEGORIZED_ID) throw badRequest('The Uncategorized group cannot be deleted');
    db.transaction((tx) => {
      tx.update(subscriptions)
        .set({ categoryId: UNCATEGORIZED_ID })
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.categoryId, id)))
        .run();
      tx.delete(categories)
        .where(and(eq(categories.userId, userId), eq(categories.id, id)))
        .run();
    });
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Articles
  // -------------------------------------------------------------------------

  app.get('/articles', (c) => {
    const userId = c.get('user').id;
    const q = c.req.query();
    const limit = Math.min(PAGE_MAX, Math.max(1, Number(q.limit) || PAGE_DEFAULT));
    const where: SQL[] = [];

    if (q.feed) where.push(sql`a.feed_id = ${q.feed}`);
    if (q.category) where.push(sql`sub.category_id = ${q.category}`);
    if (q.unread === '1' || q.unread === 'true') where.push(sql`coalesce(s.read, 0) = 0`);
    if (q.starred === '1' || q.starred === 'true') where.push(sql`s.starred = 1`);
    for (const term of searchTerms(q.q).slice(0, 10)) {
      where.push(sql`a.search_text like ${`%${escapeLike(term)}%`} escape '\\'`);
    }
    if (q.before) {
      const cursor = decodeCursor(q.before);
      where.push(
        sql`(a.published_at, a.feed_id, a.id) < (${cursor.publishedAt}, ${cursor.feedId}, ${cursor.id})`,
      );
    }

    const rows = db.all<ArticleRow>(sql`
      select ${ARTICLE_COLUMNS}
      from articles a
      left join subscriptions sub on sub.feed_id = a.feed_id and sub.user_id = ${userId}
      left join article_states s
        on s.user_id = ${userId} and s.feed_id = a.feed_id and s.article_id = a.id
      where (sub.user_id is not null or s.starred = 1)
        ${where.length ? sql`and ${sql.join(where, sql` and `)}` : sql``}
      order by a.published_at desc, a.feed_id desc, a.id desc
      limit ${limit + 1}
    `);

    const items = rows.slice(0, limit).map(toArticle);
    const last = items[items.length - 1];
    return c.json<ArticlesResponse>({
      items,
      next: rows.length > limit && last ? encodeCursor(last) : null,
    });
  });

  app.get('/articles/:feedId/:id', (c) => {
    const userId = c.get('user').id;
    const row = db.get<ArticleRow>(sql`
      select ${ARTICLE_COLUMNS}
      from articles a
      left join subscriptions sub on sub.feed_id = a.feed_id and sub.user_id = ${userId}
      left join article_states s
        on s.user_id = ${userId} and s.feed_id = a.feed_id and s.article_id = a.id
      where a.feed_id = ${c.req.param('feedId')} and a.id = ${c.req.param('id')}
        and (sub.user_id is not null or s.starred = 1)
    `);
    if (!row) throw notFound('No such article');
    return c.json({ article: toArticle(row) });
  });

  app.get('/counts', (c) => {
    const userId = c.get('user').id;
    const rows = db.all<{ feedId: string; n: number }>(sql`
      select a.feed_id as feedId, count(*) as n
      from articles a
      join subscriptions sub on sub.feed_id = a.feed_id and sub.user_id = ${userId}
      left join article_states s
        on s.user_id = ${userId} and s.feed_id = a.feed_id and s.article_id = a.id
      where coalesce(s.read, 0) = 0
      group by a.feed_id
    `);
    const starred = db
      .select({ n: count() })
      .from(articleStates)
      .where(and(eq(articleStates.userId, userId), eq(articleStates.starred, true)))
      .get();
    return c.json<CountsResponse>({
      unread: Object.fromEntries(rows.map((r) => [r.feedId, r.n])),
      starred: starred?.n ?? 0,
    });
  });

  app.post('/articles/state', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c);
    if (!Array.isArray(body.items) || body.items.length > 1000) {
      throw badRequest('"items" must be an array of at most 1000 { feedId, id }');
    }
    const read = typeof body.read === 'boolean' ? body.read : undefined;
    const starred = typeof body.starred === 'boolean' ? body.starred : undefined;
    if (read === undefined && starred === undefined)
      throw badRequest('Set "read" and/or "starred"');

    const now = Date.now();
    let changed = 0;
    db.transaction((tx) => {
      for (const item of body.items as unknown[]) {
        const { feedId, id } = (item ?? {}) as Record<string, unknown>;
        if (typeof feedId !== 'string' || typeof id !== 'string') continue;
        const exists = tx
          .select({ id: articles.id })
          .from(articles)
          .where(and(eq(articles.feedId, feedId), eq(articles.id, id)))
          .get();
        if (!exists) continue;
        tx.insert(articleStates)
          .values({
            userId,
            feedId,
            articleId: id,
            read: read ?? false,
            starred: starred ?? false,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [articleStates.userId, articleStates.feedId, articleStates.articleId],
            set: {
              ...(read !== undefined && { read }),
              ...(starred !== undefined && { starred }),
              updatedAt: now,
            },
          })
          .run();
        changed++;
      }
    });
    return c.json({ changed });
  });

  app.post('/articles/read-all', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c);
    const upTo = typeof body.upTo === 'number' ? body.upTo : Date.now();
    const feed = str(body, 'feed', { max: 64, optional: true });
    const category = str(body, 'category', { max: 64, optional: true });
    const now = Date.now();
    const result = db.run(sql`
      insert into article_states (user_id, feed_id, article_id, read, starred, updated_at)
      select ${userId}, a.feed_id, a.id, 1, 0, ${now}
      from articles a
      join subscriptions sub on sub.feed_id = a.feed_id and sub.user_id = ${userId}
      left join article_states s
        on s.user_id = ${userId} and s.feed_id = a.feed_id and s.article_id = a.id
      where coalesce(s.read, 0) = 0 and a.published_at <= ${upTo}
        ${feed ? sql`and a.feed_id = ${feed}` : sql``}
        ${category ? sql`and sub.category_id = ${category}` : sql``}
      on conflict (user_id, feed_id, article_id) do update set read = 1, updated_at = ${now}
    `);
    return c.json({ marked: result.changes });
  });

  app.post('/refresh', async (c) => {
    const userId = c.get('user').id;
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    const feedId = typeof body.feed === 'string' ? body.feed : undefined;
    const ids = db
      .select({ id: subscriptions.feedId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          feedId ? eq(subscriptions.feedId, feedId) : undefined,
        ),
      )
      .all()
      .map((r) => r.id);
    const results = await ctx.worker.refresh(ids);
    const failed = [...results.values()].filter((r) => !r.ok).length;
    return c.json({ refreshed: results.size - failed, failed });
  });

  // -------------------------------------------------------------------------
  // OPML and settings
  // -------------------------------------------------------------------------

  app.get('/opml', (c) => {
    const userId = c.get('user').id;
    const xml = buildOpml(listFeeds(db, userId) as Feed[], listCategories(db, userId));
    c.header('content-disposition', 'attachment; filename="perch-subscriptions.opml"');
    return c.body(xml, 200, { 'content-type': 'text/x-opml; charset=utf-8' });
  });

  app.post('/opml', bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    const userId = c.get('user').id;
    let parsed;
    try {
      parsed = parseOpml(await c.req.text());
    } catch {
      throw badRequest('That file is not valid OPML');
    }

    const byName = new Map(listCategories(db, userId).map((cat) => [cat.name.toLowerCase(), cat]));
    let createdCategories = 0;
    let added = 0;
    let existing = 0;
    const newFeeds: string[] = [];

    db.transaction((tx) => {
      let order = Math.max(
        0,
        ...[...byName.values()].map((cat) => cat.order).filter((o) => o < 1000),
      );
      for (const name of parsed.categories) {
        if (byName.has(name.toLowerCase())) continue;
        const cat: Category = { id: randomToken(8), name, order: (order += 10) };
        tx.insert(categories)
          .values({ userId, ...cat })
          .run();
        byName.set(name.toLowerCase(), cat);
        createdCategories++;
      }
      for (const item of parsed.feeds.slice(0, 5000)) {
        const feed = ensureFeed(tx as unknown as DB, item.url, item.title);
        const inserted = tx
          .insert(subscriptions)
          .values({
            userId,
            feedId: feed.id,
            categoryId: item.categoryName
              ? (byName.get(item.categoryName.toLowerCase())?.id ?? UNCATEGORIZED_ID)
              : UNCATEGORIZED_ID,
            addedAt: Date.now(),
          })
          .onConflictDoNothing()
          .returning({ feedId: subscriptions.feedId })
          .get();
        if (inserted) {
          added++;
          if (!feed.lastFetchedAt) newFeeds.push(feed.id);
        } else {
          existing++;
        }
      }
    });

    // Fetch the new feeds in the background; the response shouldn't wait on 200 sites.
    void ctx.worker.refresh(newFeeds);
    return c.json<OpmlImportResponse>({ added, existing, categories: createdCategories });
  });

  app.get('/settings', (c) => {
    const row = db
      .select({ data: userSettings.data })
      .from(userSettings)
      .where(eq(userSettings.userId, c.get('user').id))
      .get();
    return c.json({ settings: row?.data ?? {} });
  });

  app.put('/settings', bodyLimit({ maxSize: 32 * 1024 }), async (c) => {
    const body = await jsonBody(c);
    // Device-local settings never leave the device.
    const { pinSalt, pinHash, wallpaper, ...synced } = body as Record<string, unknown>;
    (void pinSalt, void pinHash, void wallpaper);
    const data = synced as Partial<SyncedSettings>;
    const now = Date.now();
    db.insert(userSettings)
      .values({ userId: c.get('user').id, data, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { data, updatedAt: now } })
      .run();
    return c.json({ settings: data });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listFeeds(db: DB, userId: string, feedId?: string): ServerFeed[] {
  return db
    .select({
      id: feeds.id,
      url: feeds.url,
      title: feeds.title,
      customTitle: subscriptions.customTitle,
      siteUrl: feeds.siteUrl,
      iconUrl: feeds.iconUrl,
      categoryId: subscriptions.categoryId,
      addedAt: subscriptions.addedAt,
      lastFetchedAt: feeds.lastFetchedAt,
      lastError: feeds.lastError,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
    .where(
      and(eq(subscriptions.userId, userId), feedId ? eq(subscriptions.feedId, feedId) : undefined),
    )
    .all()
    .map((f) => ({
      ...f,
      customTitle: f.customTitle ?? undefined,
      siteUrl: f.siteUrl ?? undefined,
      iconUrl: f.iconUrl ?? undefined,
      lastFetchedAt: f.lastFetchedAt ?? undefined,
      lastError: f.lastError ?? undefined,
    }));
}

function listCategories(db: DB, userId: string): Category[] {
  const rows: Category[] = db
    .select({
      id: categories.id,
      name: categories.name,
      order: categories.order,
      collapsed: categories.collapsed,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .all();
  if (!rows.some((c) => c.id === UNCATEGORIZED_ID)) rows.push({ ...UNCATEGORIZED });
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function validCategory(db: DB, userId: string, id: string): string {
  if (!id || id === UNCATEGORIZED_ID) return UNCATEGORIZED_ID;
  const found = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .get();
  if (!found) throw badRequest('No such category');
  return id;
}

const ARTICLE_COLUMNS = sql.raw(`
  a.feed_id as feedId, a.id as id, a.guid as guid, a.url as url, a.title as title,
  a.author as author, a.published_at as publishedAt, a.updated_at as updatedAt,
  a.summary_html as summaryHtml, a.content_html as contentHtml, a.enclosures as enclosures,
  a.fetched_at as fetchedAt, coalesce(s.read, 0) as read, coalesce(s.starred, 0) as starred
`);

interface ArticleRow {
  feedId: string;
  id: string;
  guid: string | null;
  url: string | null;
  title: string;
  author: string | null;
  publishedAt: number;
  updatedAt: number | null;
  summaryHtml: string | null;
  contentHtml: string | null;
  enclosures: string;
  fetchedAt: number;
  read: number;
  starred: number;
}

function toArticle(r: ArticleRow): Article {
  return {
    id: r.id,
    feedId: r.feedId,
    guid: r.guid ?? undefined,
    url: r.url ?? undefined,
    title: r.title,
    author: r.author ?? undefined,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt ?? undefined,
    summaryHtml: r.summaryHtml ?? undefined,
    contentHtml: r.contentHtml ?? undefined,
    enclosures: JSON.parse(r.enclosures || '[]'),
    read: r.read ? 1 : 0,
    starred: r.starred ? 1 : 0,
    fetchedAt: r.fetchedAt,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function encodeCursor(a: Pick<Article, 'publishedAt' | 'feedId' | 'id'>): string {
  return Buffer.from(JSON.stringify([a.publishedAt, a.feedId, a.id])).toString('base64url');
}

function decodeCursor(raw: string): { publishedAt: number; feedId: string; id: string } {
  try {
    const [publishedAt, feedId, id] = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof publishedAt === 'number' && typeof feedId === 'string' && typeof id === 'string') {
      return { publishedAt, feedId, id };
    }
  } catch {
    // fall through
  }
  throw badRequest('Invalid "before" cursor');
}
