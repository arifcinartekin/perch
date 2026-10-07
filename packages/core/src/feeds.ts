import type { Feed } from './types';
import { idFrom } from './hash';
import { bareHost, normalizeFeedUrl } from './url';

// Feed identity. Every client and the server derive the same id from the same
// URL, which is what lets subscriptions and read state merge across devices.

export function feedIdFor(url: string): string {
  return idFrom('feed', normalizeFeedUrl(url));
}

export function displayTitle(feed: Pick<Feed, 'customTitle' | 'title' | 'url'>): string {
  return feed.customTitle?.trim() || feed.title || bareHost(feed.url) || feed.url;
}
