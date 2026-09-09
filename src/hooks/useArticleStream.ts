import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/types';
import { listArticles, setRead, type ListQuery } from '@/lib/storage/articles';
import { watchLocal } from '@/lib/storage/local';

const PAGE_SIZE = 40;

export interface StreamOptions {
  feedIds?: string[];
  unreadOnly?: boolean;
  starredOnly?: boolean;
}

export function useArticleStream(options: StreamOptions) {
  const { feedIds, unreadOnly, starredOnly } = options;
  const feedKey = feedIds ? [...feedIds].sort().join(',') : '*';

  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<ListQuery['before']>(undefined);
  const reqId = useRef(0);

  const baseQuery = useCallback(
    (): ListQuery => ({ feedIds, unreadOnly, starredOnly, limit: PAGE_SIZE }),
    [feedKey, unreadOnly, starredOnly], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    cursor.current = undefined;
    const page = await listArticles(baseQuery());
    if (id !== reqId.current) return;
    setItems(page.items);
    cursor.current = page.nextCursor ?? undefined;
    setHasMore(page.nextCursor !== null);
    setLoading(false);
  }, [baseQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor.current) return;
    const id = reqId.current;
    setLoadingMore(true);
    const page = await listArticles({ ...baseQuery(), before: cursor.current });
    if (id !== reqId.current) return;
    setItems((prev) => dedupe([...prev, ...page.items]));
    cursor.current = page.nextCursor ?? undefined;
    setHasMore(page.nextCursor !== null);
    setLoadingMore(false);
  }, [baseQuery, loadingMore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reload when a background refresh completes.
  useEffect(() => {
    return watchLocal<number>('perch:lastRefresh', () => {
      void reload();
    });
  }, [reload]);

  /** Optimistically mark articles read/unread in the local list + persist. */
  const mark = useCallback(async (ids: string[], read: boolean) => {
    setItems((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, read: read ? 1 : 0 } : a)));
    await setRead(ids, read);
  }, []);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    reload,
    loadMore,
    mark,
    setItems,
  };
}

function dedupe(list: Article[]): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of list) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}
