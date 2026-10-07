import { browser } from 'wxt/browser';
import { getSettings } from '../storage/settings';

// Periodic background refresh via the alarms API. The interval mirrors
// `settings.refreshIntervalMinutes` and is rebuilt whenever settings change.

export const REFRESH_ALARM = 'perch:refresh';
const STALE_AFTER_MS = 10 * 60 * 1000;

export async function scheduleRefreshAlarm(): Promise<void> {
  const { refreshIntervalMinutes } = await getSettings();
  await browser.alarms.clear(REFRESH_ALARM);
  await browser.alarms.create(REFRESH_ALARM, {
    periodInMinutes: refreshIntervalMinutes,
    // Give the browser a minute after (re)scheduling before the first run.
    delayInMinutes: 1,
  });
}

/** True when the last global refresh is old enough to run again on startup. */
export async function refreshIsStale(): Promise<boolean> {
  const { 'perch:lastRefresh': last } = await browser.storage.local.get('perch:lastRefresh');
  return typeof last !== 'number' || Date.now() - last > STALE_AFTER_MS;
}

export async function markRefreshed(): Promise<void> {
  await browser.storage.local.set({ 'perch:lastRefresh': Date.now() });
}
