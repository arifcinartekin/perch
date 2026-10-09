import { and, asc, count, eq, gt, lt, max, or } from 'drizzle-orm';
import {
  CHAIN_BLOB_MAX,
  type ChainChangesResponse,
  type ChainPushResponse,
  type ChainRecord,
  type ChainStoredRecord,
} from '@perch/core/chain';
import { SYNC_PAGE_MAX, compareHlc, isValidHlc, type PushStatus } from '@perch/core/sync';
import type { DB } from '../db';
import { chainRecords, chains } from '../db/schema';

// The relay for sync chains. Like the account sync service it keeps, per slot,
// the write with the latest clock and numbers changes per chain; unlike it, it
// can't look inside a record, so there is nothing to apply and little to check.

/** A chain holds at most this many records (a big library is ~10 000). */
export const CHAIN_RECORDS_MAX = 100_000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const SLOT = /^[A-Za-z0-9_-]{22}$/;
const BLOB = /^[A-Za-z0-9_-]+$/;

export class ChainService {
  constructor(private readonly db: DB) {}

  /** Creates the chain for this id if it's new. */
  create(chainId: string, now = Date.now()): boolean {
    const res = this.db
      .insert(chains)
      .values({ id: chainId, createdAt: now, lastSeenAt: now })
      .onConflictDoNothing()
      .run();
    return res.changes > 0;
  }

  /** Whether the chain exists; notes that it's still in use. */
  touch(chainId: string, now = Date.now()): boolean {
    const row = this.db
      .select({ lastSeenAt: chains.lastSeenAt })
      .from(chains)
      .where(eq(chains.id, chainId))
      .get();
    if (!row) return false;
    if (now - row.lastSeenAt > TOUCH_INTERVAL_MS) {
      this.db.update(chains).set({ lastSeenAt: now }).where(eq(chains.id, chainId)).run();
    }
    return true;
  }

  delete(chainId: string): void {
    this.db.delete(chains).where(eq(chains.id, chainId)).run();
  }

  push(chainId: string, records: ChainRecord[], now = Date.now()): ChainPushResponse {
    const results = this.db.transaction((tx) => {
      let stored = tx
        .select({ n: count() })
        .from(chainRecords)
        .where(eq(chainRecords.chainId, chainId))
        .get()!.n;
      let version =
        tx
          .select({ v: max(chainRecords.version) })
          .from(chainRecords)
          .where(eq(chainRecords.chainId, chainId))
          .get()?.v ?? 0;

      return records.map((r): ChainPushResponse['results'][number] => {
        const key = typeof r?.key === 'string' ? r.key : '?';
        if (!isValid(r)) return { key, status: 'invalid' as PushStatus };
        const existing = tx
          .select({ hlc: chainRecords.hlc, version: chainRecords.version })
          .from(chainRecords)
          .where(and(eq(chainRecords.chainId, chainId), eq(chainRecords.key, r.key)))
          .get();
        if (existing && compareHlc(r.hlc, existing.hlc) <= 0) {
          return { key, status: 'stale', version: existing.version };
        }
        if (!existing && stored >= CHAIN_RECORDS_MAX) return { key, status: 'invalid' };
        if (!existing) stored++;
        version++;
        const row = {
          hlc: r.hlc,
          deleted: Boolean(r.deleted),
          ephemeral: Boolean(r.ephemeral) && !r.deleted,
          blob: r.blob,
          version,
          updatedAt: now,
        };
        tx.insert(chainRecords)
          .values({ chainId, key: r.key, ...row })
          .onConflictDoUpdate({ target: [chainRecords.chainId, chainRecords.key], set: row })
          .run();
        return { key, status: 'ok', version };
      });
    });
    return { results, cursor: this.cursor(chainId) };
  }

  changes(chainId: string, since: number, limit = SYNC_PAGE_MAX): ChainChangesResponse {
    const rows = this.db
      .select()
      .from(chainRecords)
      .where(and(eq(chainRecords.chainId, chainId), gt(chainRecords.version, since)))
      .orderBy(asc(chainRecords.version))
      .limit(Math.min(limit, SYNC_PAGE_MAX) + 1)
      .all();
    const page = rows.slice(0, limit);
    const records: ChainStoredRecord[] = page.map((r) => ({
      key: r.key,
      hlc: r.hlc,
      ...(r.deleted && { deleted: true }),
      ...(r.ephemeral && { ephemeral: true }),
      blob: r.blob,
      version: r.version,
    }));
    return {
      records,
      cursor: page.length ? page[page.length - 1]!.version : since,
      more: rows.length > limit,
    };
  }

  cursor(chainId: string): number {
    return (
      this.db
        .select({ v: max(chainRecords.version) })
        .from(chainRecords)
        .where(eq(chainRecords.chainId, chainId))
        .get()?.v ?? 0
    );
  }
}

function isValid(r: ChainRecord): boolean {
  return (
    Boolean(r) &&
    typeof r === 'object' &&
    typeof r.key === 'string' &&
    SLOT.test(r.key) &&
    isValidHlc(r.hlc) &&
    typeof r.blob === 'string' &&
    r.blob.length >= 40 &&
    r.blob.length <= CHAIN_BLOB_MAX &&
    BLOB.test(r.blob) &&
    (r.deleted === undefined || typeof r.deleted === 'boolean') &&
    (r.ephemeral === undefined || typeof r.ephemeral === 'boolean')
  );
}

/**
 * Forget what no device needs: ephemeral state after 60 days, tombstones after
 * 90, and chains nobody has used for 180 days.
 */
export function pruneChains(db: DB, now = Date.now()) {
  db.delete(chainRecords)
    .where(
      or(
        and(eq(chainRecords.ephemeral, true), lt(chainRecords.updatedAt, now - 60 * DAY)),
        and(eq(chainRecords.deleted, true), lt(chainRecords.updatedAt, now - 90 * DAY)),
      ),
    )
    .run();
  db.delete(chains)
    .where(lt(chains.lastSeenAt, now - 180 * DAY))
    .run();
}
