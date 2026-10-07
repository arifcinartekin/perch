import { feedIdFor } from '@perch/core/feeds';
import type {
  CategoryRecordData,
  FeedRecordData,
  RecordDataMap,
  RecordType,
} from '@perch/core/sync';
import type { Category, Feed } from '@perch/core/types';

// Local objects ↔ sync records. A record's "canonical" form is the part that
// matters for change detection: it is what the shadow stores, so a feed whose
// title merely changed on refresh isn't pushed again.

/** JSON with sorted keys, so equal values always serialise the same. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Sync id for a local feed. Equals feed.id unless its URL was edited after adding. */
export const feedRecordId = (feed: Pick<Feed, 'url'>) => feedIdFor(feed.url);

export function feedToRecord(feed: Feed): FeedRecordData {
  return {
    url: feed.url,
    ...(feed.title && { title: feed.title }),
    ...(feed.customTitle && { customTitle: feed.customTitle }),
    ...(feed.siteUrl && { siteUrl: feed.siteUrl }),
    categoryId: feed.categoryId,
    addedAt: feed.addedAt,
  };
}

export function categoryToRecord(category: Category): CategoryRecordData {
  return { name: category.name, order: category.order, collapsed: Boolean(category.collapsed) };
}

export function canonical<T extends RecordType>(type: T, data: RecordDataMap[T]): string {
  switch (type) {
    case 'feed': {
      const d = data as FeedRecordData;
      return stableStringify({
        url: d.url,
        customTitle: d.customTitle || null,
        categoryId: d.categoryId,
        addedAt: d.addedAt,
      });
    }
    case 'category': {
      const d = data as CategoryRecordData;
      return stableStringify({ name: d.name, order: d.order, collapsed: Boolean(d.collapsed) });
    }
    case 'setting':
      return stableStringify((data as RecordDataMap['setting']).value);
    default:
      return stableStringify(data);
  }
}
