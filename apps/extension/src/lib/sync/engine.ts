import { bareHost } from '@perch/core/url';
import {
  Hlc,
  SYNCED_SETTING_KEYS,
  isSyncedSettingKey,
  parseStateRecordId,
  recordKey,
  type RecordDataMap,
  type StateRecordData,
  type StoredRecord,
  type SyncRecord,
} from '@perch/core/sync';
import { DEFAULT_SETTINGS, type Category, type Feed, type Settings } from '@perch/core/types';
import { getCategories, saveCategories } from '../storage/categories';
import { getDB } from '../storage/db';
import { PENDING_STATES_KEY, deleteArticlesForFeed } from '../storage/articles';
import { getFeeds, saveFeeds } from '../storage/feeds';
import { getSettings, saveSettings } from '../storage/settings';
import { hasHostPermission } from '../permissions/host';
import { ServerError, syncApi } from './client';
import {
  getAccount,
  getOutbox,
  getShadow,
  getStatus,
  saveOutbox,
  saveShadow,
  setStatus,
  type Outbox,
  type Shadow,
  type SyncAccount,
} from './state';
import { canonical, categoryToRecord, feedRecordId, feedToRecord } from './records';

// One sync round: pull what changed on the server and merge it, then push what
// changed here. Runs in the background worker only, one round at a time.
//
// Change detection is a "shadow": for every record, the canonical value last
// agreed with the server. Local value ≠ shadow means the user changed it here
// and it still needs pushing — and an incoming record for that key is skipped,
// because the push that follows carries a newer clock and will win anyway.
// Read/starred changes are too numerous to diff and go through an outbox.

const PUSH_BATCH = 500;

export interface SyncResult {
  pulled: number;
  pushed: number;
  /** Feeds this device learned about and should fetch. */
  newFeedIds: string[];
}

let running: Promise<SyncResult | null> | null = null;

/** Run a sync round; concurrent calls share the one in flight. */
export function syncNow(): Promise<SyncResult | null> {
  running ??= runSync().finally(() => (running = null));
  return running;
}

async function runSync(): Promise<SyncResult | null> {
  const account = await getAccount();
  if (!account) return null;
  const status = await getStatus();
  if (status.signedOut) return null;

  const hlc = new Hlc(account.node);
  if (status.hlc) hlc.receive(status.hlc);

  try {
    const result: SyncResult = { pulled: 0, pushed: 0, newFeedIds: [] };
    let cursor = await pull(account, hlc, status.cursor, result);
    result.pushed = await push(account, hlc);
    // Pick up anything that landed meanwhile (and our own writes, harmlessly).
    if (result.pushed > 0) cursor = await pull(account, hlc, cursor, result);
    await setStatus({ cursor, hlc: hlc.now(), lastSyncAt: Date.now(), lastError: undefined });
    return result;
  } catch (err) {
    const signedOut = err instanceof ServerError && err.status === 401;
    await setStatus({
      lastError: signedOut ? 'Your session ended. Sign in again.' : (err as Error).message,
      signedOut: signedOut || undefined,
      hlc: hlc.now(),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pull(account: SyncAccount, hlc: Hlc, since: number, result: SyncResult) {
  const api = syncApi(account);
  let cursor = since;
  for (;;) {
    const page = await api.changes(cursor);
    if (page.records.length) {
      for (const r of page.records) hlc.receive(r.hlc);
      const added = await applyRemote(page.records);
      result.newFeedIds.push(...added);
      result.pulled += page.records.length;
    }
    cursor = page.cursor;
    await setStatus({ cursor });
    if (!page.more) return cursor;
  }
}

/** Merge server records into local storage. Returns ids of newly added feeds. */
export async function applyRemote(records: StoredRecord[]): Promise<string[]> {
  let feeds = await getFeeds();
  let categories = await getCategories();
  const settings = await getSettings();
  const shadow = await getShadow();
  const outbox = await getOutbox();

  const settingsPatch: Partial<Settings> = {};
  const removedFeeds: string[] = [];
  const addedFeeds: Feed[] = [];
  const states = new Map<string, StateRecordData>();
  let feedsChanged = false;
  let categoriesChanged = false;

  /** True when the user changed this record here since the last sync. */
  const editedHere = (key: string, localCanon: string | undefined) =>
    key in shadow && shadow[key] !== localCanon;

  for (const r of records) {
    const key = recordKey(r.type, r.id);
    switch (r.type) {
      case 'feed': {
        const index = feeds.findIndex((f) => f.id === r.id || feedRecordId(f) === r.id);
        const local = feeds[index];
        if (editedHere(key, local && canonical('feed', feedToRecord(local)))) break;
        feedsChanged = true;
        if (r.deleted) {
          if (local) {
            feeds = feeds.filter((_, i) => i !== index);
            removedFeeds.push(local.id);
          }
          delete shadow[key];
          break;
        }
        const d = r.data as RecordDataMap['feed'];
        if (local) {
          feeds[index] = {
            ...local,
            categoryId: d.categoryId,
            customTitle: d.customTitle || undefined,
            addedAt: d.addedAt,
          };
        } else {
          const feed: Feed = {
            id: r.id,
            url: d.url,
            title: d.title || bareHost(d.url) || d.url,
            customTitle: d.customTitle || undefined,
            siteUrl: d.siteUrl,
            categoryId: d.categoryId,
            addedAt: d.addedAt,
          };
          feeds.push(feed);
          addedFeeds.push(feed);
        }
        shadow[key] = canonical('feed', d);
        break;
      }

      case 'category': {
        const local = categories.find((c) => c.id === r.id);
        if (editedHere(key, local && canonical('category', categoryToRecord(local)))) break;
        categoriesChanged = true;
        if (r.deleted) {
          categories = categories.filter((c) => c.id !== r.id);
          delete shadow[key];
          break;
        }
        const d = r.data as RecordDataMap['category'];
        const next: Category = { id: r.id, name: d.name, order: d.order, collapsed: d.collapsed };
        categories = local
          ? categories.map((c) => (c.id === r.id ? next : c))
          : [...categories, next];
        shadow[key] = canonical('category', d);
        break;
      }

      case 'setting': {
        if (!isSyncedSettingKey(r.id)) break;
        const localCanon = canonical('setting', { value: settings[r.id] });
        if (editedHere(key, localCanon)) break;
        const value = r.deleted
          ? DEFAULT_SETTINGS[r.id]
          : (r.data as RecordDataMap['setting']).value;
        (settingsPatch as Record<string, unknown>)[r.id] = value;
        shadow[key] = canonical('setting', { value });
        break;
      }

      case 'state': {
        // A pending local change to the same article wins on push.
        if (r.id in outbox || r.deleted) break;
        states.set(r.id, r.data as StateRecordData);
        break;
      }
    }
  }

  // New feeds can only be fetched once the user grants their site.
  for (const feed of addedFeeds) {
    if (!(await hasHostPermission(feed.url))) feed.needsPermission = true;
  }
  if (feedsChanged) await saveFeeds(feeds);
  if (categoriesChanged) await saveCategories(categories);
  if (Object.keys(settingsPatch).length) {
    const saved = await saveSettings(settingsPatch);
    // Normalising may adjust a value; record what we actually hold.
    for (const k of Object.keys(settingsPatch) as (keyof Settings)[]) {
      const remoteCanon = shadow[recordKey('setting', k)];
      const localCanon = canonical('setting', { value: saved[k] });
      if (remoteCanon !== localCanon) delete shadow[recordKey('setting', k)];
    }
  }
  for (const id of removedFeeds) await deleteArticlesForFeed(id);
  await applyStates(states);
  await saveShadow(shadow);
  return addedFeeds.map((f) => f.id);
}

/**
 * Write read/starred onto stored articles. States for articles this device
 * hasn't fetched yet are parked and applied when the article arrives.
 */
async function applyStates(states: Map<string, StateRecordData>) {
  if (states.size === 0) return;
  const db = await getDB();
  const tx = db.transaction(['articles', 'meta'], 'readwrite');
  const articles = tx.objectStore('articles');
  const meta = tx.objectStore('meta');
  const pending = ((await meta.get(PENDING_STATES_KEY)) ?? {}) as Record<string, StateRecordData>;
  for (const [id, state] of states) {
    const ids = parseStateRecordId(id);
    if (!ids) continue;
    const article = await articles.get(ids.articleId);
    if (article && article.feedId === ids.feedId) {
      const read = state.read ? 1 : 0;
      const starred = state.starred ? 1 : 0;
      if (article.read !== read || article.starred !== starred) {
        await articles.put({ ...article, read, starred });
      }
      delete pending[id];
    } else {
      pending[id] = state;
    }
  }
  await meta.put(pending, PENDING_STATES_KEY);
  await tx.done;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function push(account: SyncAccount, hlc: Hlc): Promise<number> {
  const shadow = await getShadow();
  const outbox = await getOutbox();
  const outgoing: { record: SyncRecord; canon?: string }[] = [];

  const diff = <T extends 'feed' | 'category' | 'setting'>(
    type: T,
    local: Map<string, RecordDataMap[T]>,
  ) => {
    for (const [id, data] of local) {
      const canon = canonical(type, data);
      if (shadow[recordKey(type, id)] !== canon) {
        outgoing.push({ record: { type, id, data, hlc: hlc.now() }, canon });
      }
    }
    // Present in the shadow but gone here: deleted on this device.
    for (const key of Object.keys(shadow)) {
      const prefix = `${type}:`;
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!local.has(id)) outgoing.push({ record: { type, id, hlc: hlc.now(), deleted: true } });
    }
  };

  diff('feed', new Map((await getFeeds()).map((f) => [feedRecordId(f), feedToRecord(f)])));
  diff('category', new Map((await getCategories()).map((c) => [c.id, categoryToRecord(c)])));
  const settings = await getSettings();
  diff('setting', new Map(SYNCED_SETTING_KEYS.map((k) => [k, { value: settings[k] }])));
  for (const [id, data] of Object.entries(outbox)) {
    outgoing.push({ record: { type: 'state', id, data, hlc: hlc.now() } });
  }
  if (outgoing.length === 0) return 0;

  const api = syncApi(account);
  let pushed = 0;
  for (let i = 0; i < outgoing.length; i += PUSH_BATCH) {
    const batch = outgoing.slice(i, i + PUSH_BATCH);
    const { results } = await api.push(batch.map((o) => o.record));
    // Every outcome settles the record: "ok" stored it; "stale" means a newer
    // write is on the server, which the pull that follows brings in (it was
    // written after our pull, so it's past the cursor); "invalid" would only
    // fail again.
    results.forEach((res, j) => {
      const { record, canon } = batch[j]!;
      if (res.status === 'invalid') console.warn('[sync] server rejected', res.key);
      pushed++;
      const key = recordKey(record.type, record.id);
      if (record.type !== 'state') {
        if (record.deleted) delete shadow[key];
        else shadow[key] = canon!;
      }
    });
  }
  await saveShadow(shadow);
  await clearPushedStates(outbox);
  return pushed;
}

/** Drop pushed outbox entries, keeping any that changed again during the push. */
async function clearPushedStates(pushed: Outbox) {
  const current = await getOutbox();
  for (const [id, data] of Object.entries(pushed)) {
    const now = current[id];
    if (now && now.read === data.read && now.starred === data.starred) delete current[id];
  }
  await saveOutbox(current);
}
