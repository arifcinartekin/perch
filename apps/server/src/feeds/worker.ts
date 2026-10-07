import { and, asc, exists, inArray, lt, lte, notExists, notInArray, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { articleStates, feeds, subscriptions } from '../db/schema';
import { purgeExpiredSessions } from '../auth/sessions';
import type { SafeFetch } from '../lib/safe-fetch';
import { refreshFeed, type RefreshResult } from './fetcher';

// Background refresher. Every feed is fetched once for all of its subscribers,
// with a global and a per-host concurrency cap so one big host isn't hammered.

const TICK_MS = 30_000;
const BATCH = 100;
const GLOBAL_CONCURRENCY = 6;
const PER_HOST_CONCURRENCY = 2;
const MAINTENANCE_MS = 60 * 60 * 1000;
/** Unsubscribed feeds linger this long, so unsubscribe → resubscribe keeps articles. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export class FeedWorker {
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<number>;
  private readonly inFlight = new Map<string, Promise<RefreshResult>>();
  private lastMaintenance = 0;

  constructor(
    private readonly db: DB,
    private readonly fetch: SafeFetch,
    private readonly intervalMin: number,
  ) {}

  start() {
    if (this.timer) return;
    const run = () => void this.tick().catch((err) => console.error('[worker]', err));
    run();
    this.timer = setInterval(run, TICK_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Refresh every subscribed feed that is due. Resolves with how many were fetched. */
  tick(now = Date.now()): Promise<number> {
    // Never run two ticks at once; a slow tick simply delays the next one.
    this.ticking ??= this.runDue(now).finally(() => (this.ticking = undefined));
    return this.ticking;
  }

  /** Refresh specific feeds now, regardless of schedule. */
  async refresh(feedIds: string[]): Promise<Map<string, RefreshResult>> {
    if (feedIds.length === 0) return new Map();
    const rows = this.db.select().from(feeds).where(inArray(feeds.id, feedIds)).all();
    const results = await this.runAll(rows);
    return new Map(rows.map((r, i) => [r.id, results[i]!]));
  }

  private async runDue(now: number): Promise<number> {
    if (now - this.lastMaintenance > MAINTENANCE_MS) {
      this.lastMaintenance = now;
      maintenance(this.db, now);
    }
    const busy = [...this.inFlight.keys()];
    const due = this.db
      .select()
      .from(feeds)
      .where(
        and(
          lte(feeds.nextFetchAt, now),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(subscriptions)
              .where(sql`${subscriptions.feedId} = ${feeds.id}`),
          ),
          busy.length ? notInArray(feeds.id, busy) : undefined,
        ),
      )
      .orderBy(asc(feeds.nextFetchAt))
      .limit(BATCH)
      .all();
    await this.runAll(due);
    return due.length;
  }

  private async runAll(rows: (typeof feeds.$inferSelect)[]): Promise<RefreshResult[]> {
    const results: RefreshResult[] = new Array(rows.length);
    const perHost = new Map<string, number>();
    const pending = rows.map((row, index) => ({ row, index, host: hostOf(row.url) }));
    let active = 0;

    await new Promise<void>((resolve) => {
      const pump = () => {
        if (pending.length === 0 && active === 0) return resolve();
        while (active < GLOBAL_CONCURRENCY) {
          const next = pending.findIndex((p) => (perHost.get(p.host) ?? 0) < PER_HOST_CONCURRENCY);
          if (next === -1) break;
          const { row, index, host } = pending.splice(next, 1)[0]!;
          active++;
          perHost.set(host, (perHost.get(host) ?? 0) + 1);
          void this.refreshOne(row).then((result) => {
            results[index] = result;
            active--;
            perHost.set(host, perHost.get(host)! - 1);
            pump();
          });
        }
      };
      pump();
    });
    return results;
  }

  /** Coalesces concurrent refreshes of the same feed into one request. */
  private refreshOne(row: typeof feeds.$inferSelect): Promise<RefreshResult> {
    let job = this.inFlight.get(row.id);
    if (!job) {
      job = refreshFeed(this.db, this.fetch, row, this.intervalMin)
        .catch((err: Error): RefreshResult => ({ ok: false, error: err.message }))
        .finally(() => this.inFlight.delete(row.id));
      this.inFlight.set(row.id, job);
    }
    return job;
  }
}

/**
 * Drop feeds nobody subscribes to (their articles cascade) unless someone
 * starred one of them, and expired sessions.
 */
export function maintenance(db: DB, now = Date.now()) {
  db.delete(feeds)
    .where(
      and(
        // Subscribed feeds are fetched every interval, so a stale fetch time means
        // nobody has subscribed for at least the grace period.
        lt(sql`coalesce(${feeds.lastFetchedAt}, ${feeds.createdAt})`, now - ORPHAN_GRACE_MS),
        notExists(
          db
            .select({ one: sql`1` })
            .from(subscriptions)
            .where(sql`${subscriptions.feedId} = ${feeds.id}`),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(articleStates)
            .where(sql`${articleStates.feedId} = ${feeds.id} and ${articleStates.starred} = 1`),
        ),
      ),
    )
    .run();
  purgeExpiredSessions(db, now);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
