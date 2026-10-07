import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from '@perch/core/types';
import { useBackend, type ArticleRef, type StreamScope } from '../backend';

const PAGE_SIZE = 40;

export interface StreamOptions {
  scope: StreamScope;
  /** The scope's feeds; undefined = every feed. */
  feedIds?: string[];
  unreadOnly?: boolean;
  /** Free-text search query. */
  text?: string;
}

export function useArticleStream(options: StreamOptions) {
  const backend = useBackend();
  const { scope, feedIds, unreadOnly, text } = options;
  const scopeKey = `${scope.kind}:${'id' in scope ? scope.id : ''}`;
  const feedKey = feedIds ? [...feedIds].sort().join(',') : '*';

  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const reqId = useRef(0);

  const baseQuery = useCallback(
    () => ({ scope, feedIds, unreadOnly, text, limit: PAGE_SIZE }),
    [scopeKey, feedKey, unreadOnly, text], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    cursor.current = null;
    const page = await backend.listArticles(baseQuery());
    if (id !== reqId.current) return;
    setItems(page.items);
    cursor.current = page.next;
    setHasMore(page.next !== null);
    setLoading(false);
  }, [backend, baseQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor.current) return;
    const id = reqId.current;
    setLoadingMore(true);
    const page = await backend.listArticles({ ...baseQuery(), cursor: cursor.current });
    if (id !== reqId.current) return;
    setItems((prev) => dedupe([...prev, ...page.items]));
    cursor.current = page.next;
    setHasMore(page.next !== null);
    setLoadingMore(false);
  }, [backend, baseQuery, loadingMore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reload when new articles arrive (a background refresh, another device).
  useEffect(() => backend.watch({ articles: () => void reload() }), [backend, reload]);

  /** Optimistically mark articles read/unread in the list, then persist. */
  const mark = useCallback(
    async (refs: ArticleRef[], read: boolean) => {
      const keys = new Set(refs.map(keyOf));
      setItems((prev) => prev.map((a) => (keys.has(keyOf(a)) ? { ...a, read: read ? 1 : 0 } : a)));
      await backend.setRead(refs, read);
    },
    [backend],
  );

  return { items, loading, loadingMore, hasMore, reload, loadMore, mark, setItems };
}

const keyOf = (a: ArticleRef) => `${a.feedId}:${a.id}`;

function dedupe(list: Article[]): Article[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = keyOf(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
