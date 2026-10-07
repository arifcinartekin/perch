import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Category, Feed } from '@perch/core/types';
import { UNCATEGORIZED_ID } from '@perch/core/types';
import { displayTitle } from '@perch/core/feeds';
import { useBackend } from '../backend';

// The reader's shared view of the feed library: feeds, categories, and unread
// counts. Reloaded when the backend reports a change, plus a manual
// `refreshCounts` for after a feed refresh.

export interface LibraryValue {
  feeds: Feed[];
  categories: Category[];
  unreadByFeed: Record<string, number>;
  loading: boolean;
  refreshCounts: () => Promise<void>;
  /** Feeds grouped by category, in sidebar order. */
  grouped: { category: Category; feeds: Feed[] }[];
  feedById: (id: string) => Feed | undefined;
  unreadForFeeds: (ids: string[]) => number;
  totalUnread: number;
}

const LibraryContext = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([backend.loadLibrary(), backend.unreadCounts()]).then(([lib, counts]) => {
        if (!alive) return;
        setFeeds(lib.feeds);
        setCategories(lib.categories);
        setUnreadByFeed(counts);
        setLoading(false);
      });
    void load();
    const unwatch = backend.watch({
      library: () => void load(),
      articles: () => void backend.unreadCounts().then((c) => alive && setUnreadByFeed(c)),
    });
    return () => {
      alive = false;
      unwatch();
    };
  }, [backend]);

  const value = useMemo<LibraryValue>(() => {
    const feedById = (id: string) => feeds.find((f) => f.id === id);
    const unreadForFeeds = (ids: string[]) =>
      ids.reduce((sum, id) => sum + (unreadByFeed[id] ?? 0), 0);

    const sortedFeeds = [...feeds].sort((a, b) =>
      displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }),
    );

    // A feed can point at a category deleted on another device; show it ungrouped.
    const known = new Set(categories.map((c) => c.id));
    const groupOf = (f: (typeof feeds)[number]) =>
      f.categoryId && known.has(f.categoryId) ? f.categoryId : UNCATEGORIZED_ID;
    const grouped = [...categories]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((category) => ({
        category,
        feeds: sortedFeeds.filter((f) => groupOf(f) === category.id),
      }))
      // Hide empty categories except "Uncategorized" (keeps the sidebar tidy).
      .filter((g) => g.feeds.length > 0 || g.category.id === UNCATEGORIZED_ID);

    return {
      feeds: sortedFeeds,
      categories,
      unreadByFeed,
      loading,
      refreshCounts: () => backend.unreadCounts().then(setUnreadByFeed),
      grouped,
      feedById,
      unreadForFeeds,
      totalUnread: Object.values(unreadByFeed).reduce((a, b) => a + b, 0),
    };
  }, [backend, feeds, categories, unreadByFeed, loading]);

  return createElement(LibraryContext.Provider, { value }, children);
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within <LibraryProvider>');
  return ctx;
}
