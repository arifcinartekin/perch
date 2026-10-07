import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { registerMessageHandlers } from '@/lib/messaging';
import { addFeed, removeFeed } from '@/lib/storage/feeds';
import { deleteArticlesForFeed } from '@/lib/storage/articles';
import { getSettings, watchSettings } from '@/lib/storage/settings';
import { refreshFeed, refreshFeeds } from '@/lib/feeds/refresh';
import { openReader } from '@/lib/background/open-reader';
import {
  REFRESH_ALARM,
  markRefreshed,
  refreshIsStale,
  scheduleRefreshAlarm,
} from '@/lib/background/schedule';
import {
  forgetTab,
  getCachedDiscovery,
  scanTab,
  setAutoScan,
} from '@/lib/background/discovery-manager';
import { clearDiscoveryDot } from '@/lib/badge';
import { onPermissionsChanged } from '@/lib/permissions/host';

export default defineBackground(() => {
  registerMessageHandlers({
    'discovery:get': async ({ tabId }) => {
      const id = tabId ?? (await activeTabId());
      if (id == null) return null;
      const tab = await safeGetTab(id);
      if (!tab?.url) return getCachedDiscovery(id);
      const cached = getCachedDiscovery(id);
      // Serve the cache only when it is for the page currently shown.
      if (cached && cached.pageUrl === tab.url) return cached;
      return scanTab(id, tab.url);
    },

    'discovery:rescan': async ({ tabId }) => {
      const tab = await safeGetTab(tabId);
      if (!tab?.url) return null;
      return scanTab(tabId, tab.url, { force: true });
    },

    'feed:add': async (payload, sender) => {
      const { feed, created } = await addFeed({
        url: payload.url,
        title: payload.title,
        siteUrl: payload.siteUrl,
        iconUrl: payload.iconUrl,
        categoryId: payload.categoryId,
        needsPermission: payload.needsPermission,
      });
      // First fetch (best effort) so the reader isn't empty.
      void refreshFeed(feed).catch(() => undefined);

      const tabId = sender.tab?.id;
      if (tabId != null) {
        const tab = await safeGetTab(tabId);
        if (tab?.url) await scanTab(tabId, tab.url, { force: true });
      }
      return { feedId: feed.id, created };
    },

    'feed:remove': async ({ feedId }) => {
      await removeFeed(feedId);
      await deleteArticlesForFeed(feedId);
      // Refresh discovery badges on any tab showing that site.
      const tabs = await browser.tabs.query({});
      for (const t of tabs) {
        if (t.id != null && t.url) void scanTab(t.id, t.url, { force: true });
      }
      return { ok: true as const };
    },

    'feeds:refresh': async ({ feedIds }) => {
      const summary = await refreshFeeds(feedIds);
      await markRefreshed();
      return { refreshed: summary.refreshed, failed: summary.failed };
    },

    'reader:open': async () => {
      await openReader();
      return { ok: true as const };
    },

    'badge:clear': async ({ tabId }) => {
      await clearDiscoveryDot(tabId);
      return { ok: true as const };
    },

    'alarms:reschedule': async () => {
      await scheduleRefreshAlarm();
      return { ok: true as const };
    },
  });

  // --- lifecycle ------------------------------------------------------------

  browser.runtime.onInstalled.addListener(async () => {
    await scheduleRefreshAlarm();
    const settings = await getSettings();
    await setAutoScan(settings.autoDiscovery);
  });

  browser.runtime.onStartup.addListener(async () => {
    await scheduleRefreshAlarm();
    const settings = await getSettings();
    await setAutoScan(settings.autoDiscovery);
    if (await refreshIsStale()) {
      await refreshFeeds();
      await markRefreshed();
    }
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== REFRESH_ALARM) return;
    await refreshFeeds();
    await markRefreshed();
  });

  // React to settings changes: reschedule the alarm, toggle auto-scan.
  watchSettings(async (settings) => {
    await scheduleRefreshAlarm();
    await setAutoScan(settings.autoDiscovery);
  });

  // If the user revokes the all-sites permission, stop auto-scanning.
  onPermissionsChanged(async () => {
    const settings = await getSettings();
    await setAutoScan(settings.autoDiscovery);
  });

  browser.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

  // Best-effort: prime auto-scan on worker startup too (MV3 workers restart).
  void (async () => {
    const settings = await getSettings();
    await setAutoScan(settings.autoDiscovery);
  })();
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? undefined;
}

async function safeGetTab(tabId: number) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return undefined;
  }
}
