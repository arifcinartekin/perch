import { and, asc, eq, gt, max, sql } from 'drizzle-orm';
import { feedIdFor } from '@perch/core/feeds';
import {
  Hlc,
  SYNC_PAGE_MAX,
  compareHlc,
  isSyncedSettingKey,
  isValidHlc,
  parseStateRecordId,
  recordKey,
  type PushStatus,
  type RecordDataMap,
  type RecordType,
  type StoredRecord,
  type SyncChangesResponse,
  type SyncPushResponse,
  type SyncRecord,
} from '@perch/core/sync';
import { noteProblem } from '@perch/core/notes';
import { isHttpUrl } from '@perch/core/url';
import type { DB } from '../db';
import {
  articleStates,
  categories,
  shares,
  subscriptions,
  syncRecords,
  userSettings,
} from '../db/schema';
import { ensureFeed } from '../feeds/resolve';
import { Notifier } from '../lib/notifier';

// Every change to an account's library goes through here, whether it comes from
// a client's push or from the reader API. A record is stored only if its clock
// is newer than what we have, and in personal mode it is then applied to the
// reader tables so the worker fetches new feeds and the reader API sees it.

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/** A server-side change; the service stamps it with its own clock. */
export type LocalChange = {
  [T in RecordType]: { type: T; id: string } & (
    { data: RecordDataMap[T]; deleted?: false } | { deleted: true; data?: undefined }
  );
}[RecordType];

export class SyncService {
  private readonly hlc: Hlc;

  constructor(
    private readonly db: DB,
    private readonly notifier: Notifier = new Notifier(),
    /** Called with feeds that became subscribed and have never been fetched. */
    private readonly onNewFeeds: (feedIds: string[]) => void = () => {},
    clock?: () => number,
  ) {
    this.hlc = new Hlc('server', clock);
  }

  /** Store client records. Each is accepted only if newer than the stored one. */
  push(userId: string, records: SyncRecord[]): SyncPushResponse {
    const newFeeds: string[] = [];
    const results = this.db.transaction((tx) =>
      records.map((r) => {
        const key = typeof r?.type === 'string' ? recordKey(r.type, String(r.id)) : '?';
        const problem = validate(r);
        if (problem) return { key, status: 'invalid' as PushStatus };
        this.hlc.receive(r.hlc);
        return this.store(tx, userId, r, newFeeds);
      }),
    );
    return this.finish(userId, results, newFeeds);
  }

  /** Apply changes made through the reader API. */
  local(userId: string, changes: LocalChange[]): SyncPushResponse {
    if (changes.length === 0) return { results: [], cursor: this.cursor(userId) };
    const newFeeds: string[] = [];
    const results = this.db.transaction((tx) =>
      changes.map((c) => this.store(tx, userId, { ...c, hlc: this.hlc.now() }, newFeeds)),
    );
    return this.finish(userId, results, newFeeds);
  }

  changes(userId: string, since: number, limit = SYNC_PAGE_MAX): SyncChangesResponse {
    const rows = this.db
      .select()
      .from(syncRecords)
      .where(and(eq(syncRecords.userId, userId), gt(syncRecords.version, since)))
      .orderBy(asc(syncRecords.version))
      .limit(Math.min(limit, SYNC_PAGE_MAX) + 1)
      .all();
    const page = rows.slice(0, limit);
    const records: StoredRecord[] = page.map((r) => ({
      type: r.type,
      id: r.recordId,
      hlc: r.hlc,
      version: r.version,
      ...(r.deleted ? { deleted: true } : { data: r.data as RecordDataMap[RecordType] }),
    }));
    return {
      records,
      cursor: page.length ? page[page.length - 1]!.version : since,
      more: rows.length > limit,
    };
  }

  cursor(userId: string): number {
    return (
      this.db
        .select({ v: max(syncRecords.version) })
        .from(syncRecords)
        .where(eq(syncRecords.userId, userId))
        .get()?.v ?? 0
    );
  }

  /** Get told when an account's cursor moves (for Server-Sent Events). */
  subscribe(userId: string, listener: (cursor: number) => void): () => void {
    return this.notifier.subscribe(userId, (e) => e.type === 'cursor' && listener(e.cursor));
  }

  private finish(
    userId: string,
    results: SyncPushResponse['results'],
    newFeeds: string[],
  ): SyncPushResponse {
    const cursor = this.cursor(userId);
    if (results.some((r) => r.status === 'ok')) {
      this.notifier.emit(userId, { type: 'cursor', cursor });
    }
    if (newFeeds.length) this.onNewFeeds(newFeeds);
    return { results, cursor };
  }

  private store(
    tx: Tx,
    userId: string,
    r: SyncRecord,
    newFeeds: string[],
  ): SyncPushResponse['results'][number] {
    const key = recordKey(r.type, r.id);
    const existing = tx
      .select({ hlc: syncRecords.hlc, version: syncRecords.version })
      .from(syncRecords)
      .where(and(eq(syncRecords.userId, userId), eq(syncRecords.key, key)))
      .get();
    if (existing && compareHlc(r.hlc, existing.hlc) <= 0) {
      return { key, status: 'stale', version: existing.version };
    }

    const version =
      (tx
        .select({ v: max(syncRecords.version) })
        .from(syncRecords)
        .where(eq(syncRecords.userId, userId))
        .get()?.v ?? 0) + 1;
    const row = {
      // validate() turned away the types an account doesn't store.
      type: r.type as Exclude<SyncRecord['type'], 'device'>,
      recordId: r.id,
      data: r.deleted ? null : r.data,
      hlc: r.hlc,
      deleted: Boolean(r.deleted),
      version,
    };
    tx.insert(syncRecords)
      .values({ userId, key, ...row })
      .onConflictDoUpdate({ target: [syncRecords.userId, syncRecords.key], set: row })
      .run();

    apply(tx, userId, r, newFeeds);
    return { key, status: 'ok', version };
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isStr = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length <= max;
const optStr = (v: unknown, max = 2048) => v === undefined || isStr(v, max);

/** Why a pushed record is unacceptable, or null if it's fine. */
export function validate(r: SyncRecord): string | null {
  if (!r || typeof r !== 'object') return 'not an object';
  if (!isStr(r.id, 200) || !r.id) return 'bad id';
  if (!isValidHlc(r.hlc)) return 'bad hlc';
  // Device records belong to sync chains, which a server account isn't.
  if (r.type === 'device') return 'unknown type';
  if (r.deleted) return r.type === 'setting' && !isSyncedSettingKey(r.id) ? 'bad setting' : null;

  const d = r.data as unknown as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return 'missing data';
  switch (r.type) {
    case 'feed':
      if (!isStr(d.url) || !isHttpUrl(d.url)) return 'bad url';
      if (feedIdFor(d.url) !== r.id) return 'feed id does not match its url';
      if (!isStr(d.categoryId, 64) || !Number.isFinite(d.addedAt)) return 'bad feed fields';
      if (!optStr(d.title, 500) || !optStr(d.customTitle, 500) || !optStr(d.siteUrl)) {
        return 'bad feed fields';
      }
      return null;
    case 'category':
      if (r.id.length > 64 || !isStr(d.name, 100) || !Number.isInteger(d.order)) {
        return 'bad category';
      }
      return d.collapsed === undefined || typeof d.collapsed === 'boolean' ? null : 'bad category';
    case 'setting':
      if (!isSyncedSettingKey(r.id)) return 'bad setting';
      return JSON.stringify(d.value ?? null).length <= 8192 ? null : 'setting too large';
    case 'state':
      if (!parseStateRecordId(r.id)) return 'bad state id';
      return typeof d.read === 'boolean' && typeof d.starred === 'boolean' ? null : 'bad state';
    case 'note': {
      const ids = parseStateRecordId(r.id);
      if (!ids) return 'bad note id';
      const problem = noteProblem(d as Partial<RecordDataMap['note']>);
      if (problem) return `bad note (${problem})`;
      return d.feedId === ids.feedId && d.articleId === ids.articleId ? null : 'note id mismatch';
    }
    default:
      return 'unknown type';
  }
}

// ---------------------------------------------------------------------------
// Personal mode: keep the reader tables in step
// ---------------------------------------------------------------------------

function apply(tx: Tx, userId: string, r: SyncRecord, newFeeds: string[]) {
  switch (r.type) {
    case 'feed': {
      if (r.deleted) {
        tx.delete(subscriptions)
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, r.id)))
          .run();
        // Starred articles outlive the subscription.
        tx.delete(articleStates)
          .where(
            and(
              eq(articleStates.userId, userId),
              eq(articleStates.feedId, r.id),
              eq(articleStates.starred, false),
            ),
          )
          .run();
        return;
      }
      const d = r.data as RecordDataMap['feed'];
      const feed = ensureFeed(tx as unknown as DB, d.url, d.title);
      if (!feed.lastFetchedAt) newFeeds.push(feed.id);
      const sub = {
        categoryId: d.categoryId,
        customTitle: d.customTitle?.trim() || null,
        addedAt: d.addedAt,
      };
      tx.insert(subscriptions)
        .values({ userId, feedId: feed.id, ...sub })
        .onConflictDoUpdate({ target: [subscriptions.userId, subscriptions.feedId], set: sub })
        .run();
      return;
    }
    case 'category': {
      if (r.deleted) {
        tx.delete(categories)
          .where(and(eq(categories.userId, userId), eq(categories.id, r.id)))
          .run();
        return;
      }
      const d = r.data as RecordDataMap['category'];
      const row = { name: d.name, order: d.order, collapsed: d.collapsed ?? false };
      tx.insert(categories)
        .values({ userId, id: r.id, ...row })
        .onConflictDoUpdate({ target: [categories.userId, categories.id], set: row })
        .run();
      return;
    }
    case 'setting': {
      const current =
        tx
          .select({ data: userSettings.data })
          .from(userSettings)
          .where(eq(userSettings.userId, userId))
          .get()?.data ?? {};
      const next: Record<string, unknown> = { ...current };
      if (r.deleted) delete next[r.id];
      else next[r.id] = (r.data as RecordDataMap['setting']).value;
      const now = Date.now();
      tx.insert(userSettings)
        .values({ userId, data: next, updatedAt: now })
        .onConflictDoUpdate({ target: userSettings.userId, set: { data: next, updatedAt: now } })
        .run();
      return;
    }
    case 'state': {
      const { feedId, articleId } = parseStateRecordId(r.id)!;
      const where = and(
        eq(articleStates.userId, userId),
        eq(articleStates.feedId, feedId),
        eq(articleStates.articleId, articleId),
      );
      if (r.deleted) {
        tx.delete(articleStates).where(where).run();
        return;
      }
      const d = r.data as RecordDataMap['state'];
      const row = { read: d.read, starred: d.starred, updatedAt: Date.now() };
      tx.insert(articleStates)
        .values({ userId, feedId, articleId, ...row })
        .onConflictDoUpdate({
          target: [articleStates.userId, articleStates.feedId, articleStates.articleId],
          set: row,
        })
        .run();
      return;
    }
    case 'note': {
      // A shared note's public copy follows it: edits show, deleting unshares.
      const where = and(eq(shares.userId, userId), eq(shares.noteId, r.id));
      if (r.deleted) {
        tx.delete(shares).where(where).run();
        return;
      }
      const d = r.data as RecordDataMap['note'];
      tx.update(shares)
        .set({
          title: d.title,
          url: d.url ?? null,
          feedTitle: d.feedTitle ?? null,
          body: d.body,
          updatedAt: Date.now(),
        })
        .where(where)
        .run();
      return;
    }
  }
}

/**
 * Forget sync history nobody needs: read, unstarred state older than 60 days
 * (the articles are pruned by then) and tombstones older than 90.
 */
export function pruneSyncRecords(db: DB, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const before = (ms: number) => String(now - ms).padStart(13, '0');
  db.delete(syncRecords)
    .where(
      sql`(${syncRecords.type} = 'state' and ${syncRecords.deleted} = 0
            and json_extract(${syncRecords.data}, '$.starred') = 0
            and ${syncRecords.hlc} < ${before(60 * day)})
       or (${syncRecords.deleted} = 1 and ${syncRecords.hlc} < ${before(90 * day)})`,
    )
    .run();
}
