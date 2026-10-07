import { browser } from 'wxt/browser';
import { clearDiscoveryDot, showDiscoveryDot } from '../badge';
import { discoverForTab } from '../discovery';
import { hasAllSites } from '../permissions/host';
import { isHttpUrl } from '@perch/core/url';
import type { TabDiscovery } from '@perch/core/types';

// Owns per-tab discovery state for the background worker. In manual mode the
// popup drives scans on demand; in auto mode (all-sites permission granted) we
// also scan on navigation and light up the toolbar badge.

const cache = new Map<number, TabDiscovery>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const debounce = new Map<number, ReturnType<typeof setTimeout>>();

let autoScanEnabled = false;

export function getCachedDiscovery(tabId: number): TabDiscovery | null {
  const entry = cache.get(tabId);
  if (!entry) return null;
  if (Date.now() - entry.scannedAt > CACHE_TTL_MS) return entry; // stale but usable
  return entry;
}

export async function scanTab(
  tabId: number,
  pageUrl: string,
  options: { force?: boolean } = {},
): Promise<TabDiscovery | null> {
  if (!isHttpUrl(pageUrl)) {
    cache.delete(tabId);
    await clearDiscoveryDot(tabId);
    return null;
  }

  const existing = cache.get(tabId);
  if (
    !options.force &&
    existing &&
    existing.pageUrl === pageUrl &&
    Date.now() - existing.scannedAt < CACHE_TTL_MS
  ) {
    return existing;
  }

  const crossOrigin = await hasAllSites();
  const outcome = await discoverForTab(tabId, pageUrl, { crossOrigin });
  const entry: TabDiscovery = {
    tabId,
    pageUrl: outcome.pageUrl,
    pageTitle: outcome.pageTitle,
    iconHref: outcome.iconHref,
    feeds: outcome.feeds,
    scannedAt: Date.now(),
  };
  cache.set(tabId, entry);

  const hasNew = entry.feeds.some((f) => !f.alreadyAdded);
  if (hasNew) await showDiscoveryDot(tabId);
  else await clearDiscoveryDot(tabId);

  return entry;
}

/** Re-evaluate the badge for a tab after the feed list changed. */
export async function refreshBadge(tabId: number): Promise<void> {
  const entry = cache.get(tabId);
  if (!entry) return;
  // Caller is expected to have updated `alreadyAdded` via a fresh scan; here we
  // just clear if nothing new remains.
  const hasNew = entry.feeds.some((f) => !f.alreadyAdded);
  if (hasNew) await showDiscoveryDot(tabId);
  else await clearDiscoveryDot(tabId);
}

export function forgetTab(tabId: number): void {
  cache.delete(tabId);
  const t = debounce.get(tabId);
  if (t) {
    clearTimeout(t);
    debounce.delete(tabId);
  }
}

// --- auto-scan wiring ---------------------------------------------------------

const onUpdated = (
  tabId: number,
  changeInfo: { status?: string; url?: string },
  tab: { url?: string; active?: boolean },
) => {
  if (!autoScanEnabled) return;
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  const url = tab.url;
  if (!url || !isHttpUrl(url)) return;
  const prev = debounce.get(tabId);
  if (prev) clearTimeout(prev);
  debounce.set(
    tabId,
    setTimeout(() => {
      debounce.delete(tabId);
      void scanTab(tabId, url).catch(() => undefined);
    }, 600),
  );
};

export async function setAutoScan(enabled: boolean): Promise<void> {
  autoScanEnabled = enabled && (await hasAllSites());

  const has = browser.tabs.onUpdated.hasListener(onUpdated);
  if (autoScanEnabled && !has) browser.tabs.onUpdated.addListener(onUpdated);
  if (!autoScanEnabled && has) browser.tabs.onUpdated.removeListener(onUpdated);

  if (!autoScanEnabled) {
    // Clear any dots we set while auto mode was on.
    for (const tabId of cache.keys()) void clearDiscoveryDot(tabId);
  }
}

export function isAutoScanEnabled(): boolean {
  return autoScanEnabled;
}
