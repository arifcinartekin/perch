import { browser } from 'wxt/browser';
import { displayTitle } from '@perch/core/feeds';
import { listArticles } from '../storage/articles';
import { getFeeds } from '../storage/feeds';
import { getLocal, setLocal } from '../storage/local';
import { getSettings } from '../storage/settings';
import { openReader } from './open-reader';

// A notification when background refresh finds new articles, as in the iPhone
// and Android apps: off until turned on in Settings, which asks for the
// optional "notifications" permission then. Articles shown once don't come
// back; the first run only remembers what's there.

const NOTIFICATIONS = { permissions: ['notifications' as const] };

const SEEN_KEY = 'perch:notify.seen';
const ITEM_COUNT = 8;
const TWO_DAYS = 2 * 24 * 3600 * 1000;
const PREFIX = 'perch-new:';

export async function canNotify(): Promise<boolean> {
  try {
    return await browser.permissions.contains(NOTIFICATIONS);
  } catch {
    return false;
  }
}

/** Asks for the permission; call it straight from the click that turns them on. */
export function requestNotifications(): Promise<boolean> {
  return browser.permissions.request(NOTIFICATIONS).catch(() => false);
}

export async function removeNotifications(): Promise<void> {
  await browser.permissions.remove(NOTIFICATIONS).catch(() => false);
}

/** After a background refresh: notify about unread articles not seen before. */
export async function notifyNewArticles(now = Date.now()): Promise<void> {
  const settings = await getSettings();
  const { items } = await listArticles({ unreadOnly: true, limit: ITEM_COUNT });
  const seenList = await getLocal<string[] | null>(SEEN_KEY, null);
  const seen = new Set(seenList ?? []);
  const ref = (a: { feedId: string; id: string }) => `${a.feedId}:${a.id}`;
  const unseen = items.filter((a) => !seen.has(ref(a)));
  await setLocal(SEEN_KEY, [...unseen.map(ref), ...(seenList ?? [])].slice(0, 400));
  const fresh = unseen.filter((a) => a.publishedAt > now - TWO_DAYS);
  if (!settings.notifyNewArticles || seenList === null || fresh.length === 0) return;
  if (!(await canNotify())) return;

  const feeds = new Map((await getFeeds()).map((f) => [f.id, displayTitle(f)]));
  const icon = browser.runtime.getURL('/icon/128.png');
  const first = fresh[0]!;
  const options =
    fresh.length === 1
      ? { title: feeds.get(first.feedId) ?? 'Perch', message: first.title }
      : {
          title: `${fresh.length} new articles`,
          message: fresh
            .slice(0, 3)
            .map((a) => a.title)
            .join('\n'),
        };
  await browser.notifications.create(PREFIX + (fresh.length === 1 ? ref(first) : ''), {
    type: 'basic',
    iconUrl: icon,
    ...options,
  });
}

let listening = false;

/**
 * Clicking one opens the reader on the article, or on the unread list. The
 * API only exists once the permission is granted, so this runs again then.
 */
export function handleNotificationClicks(): void {
  if (listening || !browser.notifications?.onClicked) return;
  listening = true;
  browser.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith(PREFIX)) return;
    const article = id.slice(PREFIX.length);
    await openReader(article ? `/?a=${encodeURIComponent(article)}` : '/');
    await browser.notifications.clear(id);
  });
}
