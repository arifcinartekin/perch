import type { NoteRecordData } from './notes';
import type { Settings } from './types';

// Sync protocol shared by every client and the server. Everything that syncs is
// a small independent record; the server orders them with a per-account
// version number and keeps, for each key, the write with the latest hybrid
// logical clock (last writer wins). Article bodies never sync — each device (or
// the server, in personal mode) fetches feeds itself, and ids are derived from
// URLs and guids, so the same article has the same id everywhere.

export type RecordType = 'feed' | 'category' | 'setting' | 'state' | 'note';

/** A subscription. id = feedIdFor(url). */
export interface FeedRecordData {
  url: string;
  title?: string;
  customTitle?: string;
  siteUrl?: string;
  categoryId: string;
  addedAt: number;
}

/** A sidebar group. id is client-generated. */
export interface CategoryRecordData {
  name: string;
  order: number;
  collapsed?: boolean;
}

/** One settings field. id = the Settings key, so fields merge independently. */
export interface SettingRecordData {
  value: unknown;
}

/** Read / starred for one article. id = stateRecordId(feedId, articleId). */
export interface StateRecordData {
  read: boolean;
  starred: boolean;
}

export interface RecordDataMap {
  feed: FeedRecordData;
  category: CategoryRecordData;
  setting: SettingRecordData;
  state: StateRecordData;
  /** A note on an article. id = stateRecordId(feedId, articleId). */
  note: NoteRecordData;
}

export interface SyncRecord<T extends RecordType = RecordType> {
  type: T;
  id: string;
  /** Absent on tombstones. */
  data?: RecordDataMap[T];
  hlc: string;
  deleted?: boolean;
}

export interface StoredRecord extends SyncRecord {
  /** Server-assigned, increasing within an account. */
  version: number;
}

export const recordKey = (type: RecordType, id: string) => `${type}:${id}`;

export const stateRecordId = (feedId: string, articleId: string) => `${feedId}:${articleId}`;

export function parseStateRecordId(id: string): { feedId: string; articleId: string } | null {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) return null;
  return { feedId: id.slice(0, i), articleId: id.slice(i + 1) };
}

/**
 * Settings that follow the account. Auto-discovery is tied to a browser
 * permission, and the PIN and wallpaper are deliberately per device.
 */
export const SYNCED_SETTING_KEYS = [
  'openMode',
  'refreshIntervalMinutes',
  'theme',
  'readingFont',
  'appearance',
  'glass',
] as const satisfies readonly (keyof Settings)[];

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

export const isSyncedSettingKey = (k: string): k is SyncedSettingKey =>
  (SYNCED_SETTING_KEYS as readonly string[]).includes(k);

// ---------------------------------------------------------------------------
// API shapes (/api/v1/sync)
// ---------------------------------------------------------------------------

export const SYNC_PAGE_MAX = 1000;
export const SYNC_PUSH_MAX = 1000;

/** GET /sync/changes?since=<version>&limit=<n> */
export interface SyncChangesResponse {
  records: StoredRecord[];
  /** Pass as `since` next time. */
  cursor: number;
  /** More records are waiting past `cursor`. */
  more: boolean;
}

/** POST /sync/push */
export interface SyncPushRequest {
  records: SyncRecord[];
}

export type PushStatus =
  /** Stored; this is now the latest value. */
  | 'ok'
  /** The server already has a newer write for this key; pull to get it. */
  | 'stale'
  /** Malformed or inconsistent (e.g. a feed id that doesn't match its URL). */
  | 'invalid';

export interface SyncPushResponse {
  results: { key: string; status: PushStatus; version?: number }[];
  cursor: number;
}

// ---------------------------------------------------------------------------
// Hybrid logical clock
// ---------------------------------------------------------------------------

// "<13-digit ms>-<4-char base-36 counter>-<node>". Fixed width, so plain string
// comparison orders by time, then counter, then node. A device whose clock runs
// behind still orders after everything it has seen, because receive() moves
// its clock past remote timestamps.

const COUNTER_MAX = 36 ** 4 - 1;

export function formatHlc(ms: number, counter: number, node: string): string {
  return `${String(ms).padStart(13, '0')}-${counter.toString(36).padStart(4, '0')}-${node}`;
}

export function parseHlc(hlc: string): { ms: number; counter: number; node: string } | null {
  const m = /^(\d{13})-([0-9a-z]{4})-(.+)$/.exec(hlc);
  if (!m) return null;
  return { ms: Number(m[1]), counter: Number.parseInt(m[2]!, 36), node: m[3]! };
}

export const isValidHlc = (hlc: unknown): hlc is string =>
  typeof hlc === 'string' && hlc.length <= 64 && parseHlc(hlc) !== null;

export const compareHlc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    private readonly clock: () => number = Date.now,
  ) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(node))
      throw new Error('HLC node must be 1–32 word characters');
  }

  /** A timestamp for a local change. */
  now(): string {
    const wall = this.clock();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.bump();
    }
    return formatHlc(this.ms, this.counter, this.node);
  }

  /** Fold in a timestamp seen from another device. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    if (!r) return;
    const max = Math.max(this.clock(), this.ms, r.ms);
    if (max === this.ms && max === r.ms) {
      this.counter = Math.max(this.counter, r.counter);
      this.bump();
    } else if (max === this.ms) {
      this.bump();
    } else if (max === r.ms) {
      this.ms = max;
      this.counter = r.counter;
      this.bump();
    } else {
      this.ms = max;
      this.counter = 0;
    }
  }

  private bump() {
    if (this.counter >= COUNTER_MAX) {
      this.ms++;
      this.counter = 0;
    } else {
      this.counter++;
    }
  }
}
