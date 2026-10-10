import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type {
  NotesResponse,
  ReportItem,
  ReportReason,
  SaveNoteRequest,
  SharedNoteSummary,
  ShareResponse,
} from '@perch/core/api';
import { noteProblem, type Note, type NoteRecordData } from '@perch/core/notes';
import { parseStateRecordId, recordKey } from '@perch/core/sync';
import { reports, shares, syncRecords, users } from '../db/schema';
import {
  HttpError,
  badRequest,
  clientIp,
  jsonBody,
  notFound,
  type AppContext,
  type Env,
} from '../http';
import { randomToken } from '../lib/crypto';
import { RateLimiter } from '../lib/ratelimit';
import { requireAdmin, requireUser } from '../auth/sessions';
import { PAGE_CSP, messagePage, sharedPage } from './page';

// Notes through the API (the web reader; other clients sync them as records),
// sharing a note as a public page, and reports on those pages.

const SHARES_MAX = 1000;
const REASONS: ReportReason[] = ['illegal', 'harassment', 'spam', 'other'];

function noteIdParam(c: Context): string {
  const id = c.req.param('id') ?? '';
  if (!parseStateRecordId(id) || id.length > 200) throw badRequest('Not a note id');
  return id;
}

function readNote(ctx: AppContext, userId: string, id: string): NoteRecordData | undefined {
  const row = ctx.db
    .select({ data: syncRecords.data, deleted: syncRecords.deleted })
    .from(syncRecords)
    .where(and(eq(syncRecords.userId, userId), eq(syncRecords.key, recordKey('note', id))))
    .get();
  return row && !row.deleted ? (row.data as NoteRecordData) : undefined;
}

const origin = (ctx: AppContext, c: Context) => ctx.config.publicUrl ?? new URL(c.req.url).origin;
export const shareUrl = (ctx: AppContext, c: Context, slug: string) =>
  `${origin(ctx, c)}/shared/${slug}`;

/** Record (or clear) the public link on the note, so every device shows it. */
function setSharedUrl(ctx: AppContext, userId: string, id: string, sharedUrl?: string) {
  const note = readNote(ctx, userId, id);
  if (!note || note.sharedUrl === sharedUrl) return;
  const { sharedUrl: _old, ...rest } = note;
  ctx.sync.local(userId, [
    { type: 'note', id, data: { ...rest, ...(sharedUrl && { sharedUrl }) } },
  ]);
}

export function noteRoutes(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use(requireUser(ctx));

  app.get('/', (c) => {
    const rows = ctx.db
      .select({ id: syncRecords.recordId, data: syncRecords.data })
      .from(syncRecords)
      .where(
        and(
          eq(syncRecords.userId, c.get('user').id),
          eq(syncRecords.type, 'note'),
          eq(syncRecords.deleted, false),
        ),
      )
      .all();
    const notes: Note[] = rows
      .map((r) => ({ ...(r.data as NoteRecordData), id: r.id }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return c.json<NotesResponse>({ notes });
  });

  app.put('/:id', async (c) => {
    const userId = c.get('user').id;
    const id = noteIdParam(c);
    const body = (await jsonBody(c)) as Partial<SaveNoteRequest>;
    const { feedId, articleId } = parseStateRecordId(id)!;
    const existing = readNote(ctx, userId, id);
    const now = Date.now();
    const data: NoteRecordData = {
      feedId,
      articleId,
      title: typeof body.title === 'string' ? body.title.slice(0, 1000) : '',
      ...(typeof body.url === 'string' && body.url && { url: body.url }),
      ...(typeof body.feedTitle === 'string' && body.feedTitle && { feedTitle: body.feedTitle }),
      body: typeof body.body === 'string' ? body.body : '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.sharedUrl && { sharedUrl: existing.sharedUrl }),
    };
    const problem = noteProblem(data);
    if (problem) throw badRequest(`The note is not valid (${problem})`);
    ctx.sync.local(userId, [{ type: 'note', id, data }]);
    return c.json({ note: { ...data, id } satisfies Note });
  });

  app.delete('/:id', (c) => {
    ctx.sync.local(c.get('user').id, [{ type: 'note', id: noteIdParam(c), deleted: true }]);
    return c.json({ ok: true });
  });

  return app;
}

export function shareRoutes(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use(requireUser(ctx));
  const limit = new RateLimiter(60, 60 * 60 * 1000);

  app.get('/', (c) => {
    const rows = ctx.db
      .select()
      .from(shares)
      .where(eq(shares.userId, c.get('user').id))
      .orderBy(asc(shares.createdAt))
      .all();
    return c.json<{ shares: SharedNoteSummary[] }>({
      shares: rows.map((r) => ({
        noteId: r.noteId,
        slug: r.slug,
        url: shareUrl(ctx, c, r.slug),
        title: r.title,
        ...(r.feedTitle && { feedTitle: r.feedTitle }),
        updatedAt: r.updatedAt,
        ...(r.hiddenAt && { hidden: true }),
      })),
    });
  });

  // The note comes in the body: from a device whose library syncs by chain,
  // or any other. A personal server can also publish the copy it already
  // has, and then keeps the copy in step as the note changes.
  app.put('/:id', async (c) => {
    const user = c.get('user');
    const id = noteIdParam(c);
    const wait = limit.retryAfter(user.id);
    if (wait > 0)
      throw new HttpError(429, 'rate-limited', `Too many shares; try again in ${wait}s`);
    limit.hit(user.id);

    const body = (await c.req.json().catch(() => ({}))) as Partial<SaveNoteRequest>;
    const sent = typeof body.body === 'string';
    const stored = ctx.config.mode === 'personal' ? readNote(ctx, user.id, id) : undefined;
    const { feedId, articleId } = parseStateRecordId(id)!;
    const now = Date.now();
    const note: NoteRecordData | undefined = sent
      ? {
          feedId,
          articleId,
          title: typeof body.title === 'string' ? body.title.slice(0, 1000) : '',
          ...(typeof body.url === 'string' && body.url && { url: body.url }),
          ...(typeof body.feedTitle === 'string' &&
            body.feedTitle && { feedTitle: body.feedTitle.slice(0, 300) }),
          body: body.body!,
          createdAt: now,
          updatedAt: now,
        }
      : stored;
    if (!note) throw new HttpError(404, 'note-not-found', 'Save the note before sharing it');
    const problem = noteProblem(note);
    if (problem) throw badRequest(`The note is not valid (${problem})`);
    if (!note.body.trim()) throw badRequest('An empty note can’t be shared');

    const where = and(eq(shares.userId, user.id), eq(shares.noteId, id));
    let slug = ctx.db.select({ slug: shares.slug }).from(shares).where(where).get()?.slug;
    const copy = {
      title: note.title,
      url: note.url ?? null,
      feedTitle: note.feedTitle ?? null,
      body: note.body,
      updatedAt: Date.now(),
    };
    if (slug) {
      ctx.db.update(shares).set(copy).where(where).run();
    } else {
      const n = ctx.db.select({ n: count() }).from(shares).where(eq(shares.userId, user.id)).get()!
        .n;
      if (n >= SHARES_MAX)
        throw new HttpError(403, 'too-many-shares', 'You have shared too many notes');
      slug = randomToken(9);
      ctx.db
        .insert(shares)
        .values({ slug, userId: user.id, noteId: id, ...copy })
        .run();
    }
    const url = shareUrl(ctx, c, slug);
    setSharedUrl(ctx, user.id, id, url);
    return c.json<ShareResponse>({ url, slug });
  });

  app.delete('/:id', (c) => {
    const user = c.get('user');
    const id = noteIdParam(c);
    ctx.db
      .delete(shares)
      .where(and(eq(shares.userId, user.id), eq(shares.noteId, id)))
      .run();
    setSharedUrl(ctx, user.id, id, undefined);
    return c.json({ ok: true });
  });

  return app;
}

/** The public pages: /shared/:slug and its report form. Not under /api. */
export function sharedPages(ctx: AppContext) {
  const app = new Hono<Env>();
  const reportLimit = new RateLimiter(10, 60 * 60 * 1000);

  const html = (c: Context, body: string, status: 200 | 404 | 410 | 429 = 200) => {
    c.header('content-security-policy', PAGE_CSP);
    c.header('x-robots-tag', 'noindex, nofollow');
    c.header('referrer-policy', 'no-referrer');
    c.header('cache-control', 'no-cache');
    return c.html(body, status);
  };

  const find = (slug: string) =>
    ctx.db
      .select({
        slug: shares.slug,
        title: shares.title,
        url: shares.url,
        feedTitle: shares.feedTitle,
        body: shares.body,
        updatedAt: shares.updatedAt,
        hiddenAt: shares.hiddenAt,
        author: users.username,
      })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.userId))
      .where(eq(shares.slug, slug))
      .get();

  app.get('/:slug', (c) => {
    const note = find(c.req.param('slug'));
    if (!note) {
      return html(
        c,
        messagePage('Note not found', 'It may have been unshared by its author.'),
        404,
      );
    }
    if (note.hiddenAt) {
      return html(c, messagePage('Note removed', 'This note was removed after a report.'), 410);
    }
    return html(c, sharedPage(note, shareUrl(ctx, c, note.slug), ctx.config));
  });

  app.post('/:slug/report', async (c) => {
    const slug = c.req.param('slug');
    if (!find(slug))
      return html(c, messagePage('Note not found', 'There is nothing to report.'), 404);
    const ip = clientIp(c, ctx.config);
    if (reportLimit.retryAfter(ip) > 0) {
      return html(c, messagePage('Too many reports', 'Please try again later.'), 429);
    }
    reportLimit.hit(ip);
    const form = await c.req.parseBody();
    const field = (k: string, max: number) =>
      typeof form[k] === 'string' ? (form[k] as string).trim().slice(0, max) : '';
    const reason = field('reason', 20) as ReportReason;
    ctx.db
      .insert(reports)
      .values({
        id: randomToken(9),
        slug,
        reason: REASONS.includes(reason) ? reason : 'other',
        details: field('details', 2000),
        contact: field('contact', 320) || null,
        createdAt: Date.now(),
      })
      .run();
    return html(c, messagePage('Thanks for the report', 'Someone will look at this note soon.'));
  });

  return app;
}

export function reportRoutes(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use(requireUser(ctx), requireAdmin);

  app.get('/', (c) => {
    const rows = ctx.db
      .select({
        id: reports.id,
        reason: reports.reason,
        details: reports.details,
        contact: reports.contact,
        createdAt: reports.createdAt,
        slug: shares.slug,
        title: shares.title,
        body: shares.body,
        hiddenAt: shares.hiddenAt,
        author: users.username,
      })
      .from(reports)
      .innerJoin(shares, eq(shares.slug, reports.slug))
      .innerJoin(users, eq(users.id, shares.userId))
      .where(isNull(reports.resolvedAt))
      .orderBy(asc(reports.createdAt))
      .all();
    const items: ReportItem[] = rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      ...(r.contact && { contact: r.contact }),
      createdAt: r.createdAt,
      share: {
        slug: r.slug,
        url: shareUrl(ctx, c, r.slug),
        title: r.title,
        body: r.body,
        author: r.author,
        hidden: r.hiddenAt != null,
      },
    }));
    return c.json({ reports: items });
  });

  /** Close a report: `hide` takes the page down (for every report on it), `dismiss` leaves it up. */
  app.post('/:id', async (c) => {
    const body = await jsonBody(c);
    const action = body.action;
    if (action !== 'hide' && action !== 'dismiss')
      throw badRequest('"action" must be hide or dismiss');
    const report = ctx.db
      .select()
      .from(reports)
      .where(eq(reports.id, c.req.param('id')))
      .get();
    if (!report) throw notFound('No such report');
    const now = Date.now();
    // A reporter's address is kept only until the report is dealt with.
    if (action === 'hide') {
      ctx.db.update(shares).set({ hiddenAt: now }).where(eq(shares.slug, report.slug)).run();
      ctx.db
        .update(reports)
        .set({ resolvedAt: now, contact: null })
        .where(and(eq(reports.slug, report.slug), isNull(reports.resolvedAt)))
        .run();
    } else {
      ctx.db
        .update(reports)
        .set({ resolvedAt: now, contact: null })
        .where(eq(reports.id, report.id))
        .run();
    }
    return c.json({ ok: true });
  });

  return app;
}
