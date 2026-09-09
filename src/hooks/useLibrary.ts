import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Category, Feed } from '@/lib/types';
import { UNCATEGORIZED_ID } from '@/lib/types';
import { getCategories, watchCategories } from '@/lib/storage/categories';
import { displayTitle, getFeeds, watchFeeds } from '@/lib/storage/feeds';
import { unreadCountsByFeed } from '@/lib/storage/articles';

// The reader's shared view of the feed library: feeds, categories, and unread
// counts. Backed by storage watchers so every context stays in sync, plus a
// manual `refreshCounts` for after a feed refresh.

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
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [unreadByFeed, setUnreadByFeed] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const refreshCounts = () => unreadCountsByFeed().then((c) => alive && setUnreadByFeed(c));

    void Promise.all([getFeeds(), getCategories(), unreadCountsByFeed()]).then(([f, c, u]) => {
      if (!alive) return;
      setFeeds(f);
      setCategories(c);
      setUnreadByFeed(u);
      setLoading(false);
    });

    const unwatchFeeds = watchFeeds((f) => {
      if (!alive) return;
      setFeeds(f);
      void refreshCounts();
    });
    const unwatchCats = watchCategories((c) => alive && setCategories(c));

    return () => {
      alive = false;
      unwatchFeeds();
      unwatchCats();
    };
  }, []);

  const value = useMemo<LibraryValue>(() => {
    const feedById = (id: string) => feeds.find((f) => f.id === id);
    const unreadForFeeds = (ids: string[]) =>
      ids.reduce((sum, id) => sum + (unreadByFeed[id] ?? 0), 0);

    const sortedFeeds = [...feeds].sort((a, b) =>
      displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }),
    );

    const grouped = [...categories]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((category) => ({
        category,
        feeds: sortedFeeds.filter((f) => (f.categoryId || UNCATEGORIZED_ID) === category.id),
      }))
      // Hide empty categories except "Uncategorized" (keeps the sidebar tidy).
      .filter((g) => g.feeds.length > 0 || g.category.id === UNCATEGORIZED_ID);

    return {
      feeds: sortedFeeds,
      categories,
      unreadByFeed,
      loading,
      refreshCounts: () => unreadCountsByFeed().then(setUnreadByFeed),
      grouped,
      feedById,
      unreadForFeeds,
      totalUnread: Object.values(unreadByFeed).reduce((a, b) => a + b, 0),
    };
  }, [feeds, categories, unreadByFeed, loading]);

  return createElement(LibraryContext.Provider, { value }, children);
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within <LibraryProvider>');
  return ctx;
}
