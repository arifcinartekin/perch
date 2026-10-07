import { browser } from 'wxt/browser';
import { refreshFeeds } from '../feeds/refresh';
import { KEYS, watchLocal } from '../storage/local';
import { syncNow, type SyncResult } from './engine';
import { SYNC_KEYS, getAccount } from './state';

// When sync runs: every few minutes, a moment after anything syncable changes
// here, right after signing in, and when the reader asks.

export const SYNC_ALARM = 'perch:sync';
const PERIOD_MIN = 5;
const DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Sync, then fetch any feeds that arrived from other devices. */
export async function syncAndFetch(): Promise<SyncResult | null> {
  const result = await syncNow();
  if (result?.newFeedIds.length) {
    // Feeds whose site isn't granted yet are skipped and flagged "needs access".
    void refreshFeeds(result.newFeedIds).catch(() => undefined);
  }
  return result;
}

function soon() {
  clearTimeout(timer);
  timer = setTimeout(() => void syncAndFetch().catch(() => undefined), DEBOUNCE_MS);
}

export async function scheduleSyncAlarm(): Promise<void> {
  if (await getAccount()) {
    await browser.alarms.create(SYNC_ALARM, { periodInMinutes: PERIOD_MIN });
  } else {
    await browser.alarms.clear(SYNC_ALARM);
  }
}

export function startSyncTriggers(): void {
  for (const key of [KEYS.feeds, KEYS.categories, KEYS.settings, SYNC_KEYS.outbox]) {
    watchLocal(key, async () => {
      if (await getAccount()) soon();
    });
  }
  watchLocal(SYNC_KEYS.account, async () => {
    await scheduleSyncAlarm();
    if (await getAccount()) soon();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncAndFetch().catch(() => undefined);
  });
}
