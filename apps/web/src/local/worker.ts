import { feedLinksFromHtml } from '@perch/core/discovery/html';
import { buildCandidates } from '@perch/core/discovery/candidates';
import { parseFeed } from '@perch/core/parser';
import { registerMessageHandlers } from '@/lib/messaging';
import { addFeed, removeFeed } from '@/lib/storage/feeds';
import { deleteArticlesForFeed } from '@/lib/storage/articles';
import { watchSettings } from '@/lib/storage/settings';
import { refreshFeed, refreshFeeds } from '@/lib/feeds/refresh';
import {
  REFRESH_ALARM,
  markRefreshed,
  refreshIsStale,
  scheduleRefreshAlarm,
} from '@/lib/background/schedule';
import { scheduleSyncAlarm, startSyncTriggers, syncAndFetch } from '@/lib/sync/background';
import { browser } from './browser';

// What the extension's background worker does, done in the page while the
// web reader is open: adding and refreshing feeds, and syncing the chain.

let started = false;

export function startLocalWorker(): void {
  if (started) return;
  started = true;

  registerMessageHandlers({
    'feed:add': async (payload) => {
      const url = await resolveFeedUrl(payload.url);
      const { feed, created } = await addFeed({ ...payload, url, needsPermission: false });
      void refreshFeed(feed).catch(() => undefined);
      return { feedId: feed.id, created };
    },
    'feed:remove': async ({ feedId }) => {
      await removeFeed(feedId);
      await deleteArticlesForFeed(feedId);
      return { ok: true as const };
    },
    'feeds:refresh': async ({ feedIds }) => {
      const summary = await refreshFeeds(feedIds);
      await markRefreshed();
      return { refreshed: summary.refreshed, failed: summary.failed };
    },
    'sync:now': async () => {
      const result = await syncAndFetch();
      return { pulled: result?.pulled ?? 0, pushed: result?.pushed ?? 0 };
    },
    'alarms:reschedule': async () => {
      await scheduleRefreshAlarm();
      return { ok: true as const };
    },
  });

  startSyncTriggers();
  browser.alarms.onAlarm.addListener(async (alarm: { name: string }) => {
    if (alarm.name !== REFRESH_ALARM) return;
    await refreshFeeds();
    await markRefreshed();
  });
  watchSettings(() => void scheduleRefreshAlarm());

  void (async () => {
    await scheduleRefreshAlarm();
    await scheduleSyncAlarm();
    await syncAndFetch().catch(() => undefined);
    if (await refreshIsStale()) {
      await refreshFeeds();
      await markRefreshed();
    }
  })();
}

/**
 * The feed for an address someone typed: the address itself when it's a
 * feed, else a feed the page links to, else one in the usual places.
 */
async function resolveFeedUrl(input: string): Promise<string> {
  const isFeed = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const text = await res.text();
      try {
        parseFeed(text, res.headers.get('content-type') ?? undefined, url);
        return { feed: true as const };
      } catch {
        return { feed: false as const, text };
      }
    } catch {
      return null;
    }
  };
  const first = await isFeed(input);
  if (!first || first.feed) return input;
  const linked = feedLinksFromHtml(first.text, input)[0]?.url;
  if (linked) return linked;
  for (const candidate of buildCandidates(input).slice(0, 6)) {
    if ((await isFeed(candidate))?.feed) return candidate;
  }
  return input;
}
