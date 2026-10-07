import { type Feed, UNCATEGORIZED_ID } from '@perch/core/types';
import { normalizeFeedUrl, bareHost } from '@perch/core/url';
import { feedIdFor } from '@perch/core/feeds';
import { getLocal, setLocal, watchLocal, KEYS } from './local';

export { displayTitle, feedIdFor } from '@perch/core/feeds';

export async function getFeeds(): Promise<Feed[]> {
  return getLocal<Feed[]>(KEYS.feeds, []);
}

export async function saveFeeds(feeds: Feed[]): Promise<void> {
  await setLocal(KEYS.feeds, feeds);
}

export async function getFeed(id: string): Promise<Feed | undefined> {
  return (await getFeeds()).find((f) => f.id === id);
}

export interface AddFeedInput {
  url: string;
  title?: string;
  siteUrl?: string;
  iconUrl?: string;
  categoryId?: string;
  needsPermission?: boolean;
}

/** Add a feed if it isn't already subscribed. Returns the feed (new or existing). */
export async function addFeed(input: AddFeedInput): Promise<{ feed: Feed; created: boolean }> {
  const url = normalizeFeedUrl(input.url);
  const id = feedIdFor(url);
  const feeds = await getFeeds();
  const existing = feeds.find((f) => f.id === id);
  if (existing) return { feed: existing, created: false };

  const feed: Feed = {
    id,
    url,
    title: input.title?.trim() || bareHost(url) || url,
    siteUrl: input.siteUrl,
    iconUrl: input.iconUrl,
    categoryId: input.categoryId || UNCATEGORIZED_ID,
    addedAt: Date.now(),
    needsPermission: input.needsPermission,
  };
  await saveFeeds([...feeds, feed]);
  return { feed, created: true };
}

export async function updateFeed(id: string, patch: Partial<Feed>): Promise<void> {
  const feeds = await getFeeds();
  await saveFeeds(feeds.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)));
}

export async function removeFeed(id: string): Promise<void> {
  const feeds = await getFeeds();
  await saveFeeds(feeds.filter((f) => f.id !== id));
}

export async function renameFeed(id: string, customTitle: string): Promise<void> {
  const trimmed = customTitle.trim();
  await updateFeed(id, { customTitle: trimmed || undefined });
}

export async function moveFeedToCategory(id: string, categoryId: string): Promise<void> {
  await updateFeed(id, { categoryId });
}

/**
 * Point an existing feed at a different URL. The feed keeps its id (so cached
 * articles and read state are preserved) — only the fetch target changes. The
 * conditional-GET validators and error state are cleared so the next refresh
 * starts clean. Returns false if the URL is unchanged or already used by
 * another feed.
 */
export async function changeFeedUrl(id: string, rawUrl: string): Promise<boolean> {
  const url = normalizeFeedUrl(rawUrl);
  const feeds = await getFeeds();
  const feed = feeds.find((f) => f.id === id);
  if (!feed || normalizeFeedUrl(feed.url) === url) return false;
  if (feeds.some((f) => f.id !== id && normalizeFeedUrl(f.url) === url)) return false;
  await updateFeed(id, {
    url,
    etag: undefined,
    lastModified: undefined,
    lastError: undefined,
    needsPermission: true,
  });
  return true;
}

export async function feedByUrl(rawUrl: string): Promise<Feed | undefined> {
  const url = normalizeFeedUrl(rawUrl);
  return (await getFeeds()).find((f) => normalizeFeedUrl(f.url) === url);
}

/** Feeds are re-homed to "Uncategorized" when their category is deleted. */
export async function reassignFeedsFromCategory(categoryId: string): Promise<void> {
  const feeds = await getFeeds();
  await saveFeeds(
    feeds.map((f) => (f.categoryId === categoryId ? { ...f, categoryId: UNCATEGORIZED_ID } : f)),
  );
}

/** Which subscribed feeds belong to a given site origin/host. */
export async function feedsForSite(pageUrl: string): Promise<Feed[]> {
  const host = bareHost(pageUrl);
  if (!host) return [];
  const feeds = await getFeeds();
  return feeds.filter((f) => bareHost(f.siteUrl || f.url) === host);
}

export function watchFeeds(onChange: (feeds: Feed[]) => void): () => void {
  return watchLocal<Feed[]>(KEYS.feeds, (value) => onChange(value ?? []));
}
