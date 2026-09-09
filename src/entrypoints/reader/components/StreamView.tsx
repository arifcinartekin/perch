import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IconCheck, IconRefresh } from '@/components/icons';
import { Spinner } from '@/components/Spinner';
import { useLibrary } from '@/hooks/useLibrary';
import { useSettings } from '@/hooks/useSettings';
import { useArticleStream } from '@/hooks/useArticleStream';
import { sendMessage } from '@/lib/messaging';
import { getArticle, setStarred } from '@/lib/storage/articles';
import { UNCATEGORIZED_ID } from '@/lib/types';
import type { Article } from '@/lib/types';
import { ArticleList } from './ArticleList';
import { ArticlePane } from './ArticlePane';
import { useToast } from './Toasts';

type Scope =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'feed'; id: string }
  | { kind: 'category'; id: string };

export function AllStream() {
  return <StreamView scope={{ kind: 'all' }} />;
}
export function StarredStream() {
  return <StreamView scope={{ kind: 'starred' }} />;
}
export function FeedStream() {
  const { feedId = '' } = useParams();
  return <StreamView key={feedId} scope={{ kind: 'feed', id: feedId }} />;
}
export function CategoryStream() {
  const { categoryId = '' } = useParams();
  return <StreamView key={categoryId} scope={{ kind: 'category', id: categoryId }} />;
}

function StreamView({ scope }: { scope: Scope }) {
  const { feeds, grouped, feedById, refreshCounts } = useLibrary();
  const { settings } = useSettings();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Article | null>(null);

  const selectedId = searchParams.get('a');

  const { feedIds, title, subtitle } = useMemo(() => {
    if (scope.kind === 'all') {
      return {
        feedIds: undefined as string[] | undefined,
        title: 'All Feeds',
        subtitle: `${feeds.length} feeds`,
      };
    }
    if (scope.kind === 'starred') {
      return { feedIds: undefined, title: 'Starred', subtitle: 'Saved for later' };
    }
    if (scope.kind === 'feed') {
      const feed = feedById(scope.id);
      return {
        feedIds: [scope.id],
        title: feed ? feed.customTitle || feed.title : 'Feed',
        subtitle: feed?.siteUrl ?? feed?.url ?? '',
      };
    }
    const group = grouped.find((g) => g.category.id === scope.id);
    return {
      feedIds: (group?.feeds ?? []).map((f) => f.id),
      title: group?.category.name ?? (scope.id === UNCATEGORIZED_ID ? 'Uncategorized' : 'Category'),
      subtitle: `${group?.feeds.length ?? 0} feeds`,
    };
  }, [scope, feeds, grouped, feedById]);

  const stream = useArticleStream({
    feedIds,
    unreadOnly,
    starredOnly: scope.kind === 'starred',
  });

  // Resolve the selected article id from the URL into an Article object.
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const inList = stream.items.find((a) => a.id === selectedId);
    if (inList) {
      setSelected(inList);
      return;
    }
    let alive = true;
    void getArticle(selectedId).then((a) => alive && setSelected(a ?? null));
    return () => {
      alive = false;
    };
  }, [selectedId, stream.items]);

  const openArticle = useCallback(
    (article: Article) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('a', article.id);
          return next;
        },
        { replace: false },
      );
      if (article.read === 0) {
        void stream.mark([article.id], true).then(refreshCounts);
      }
    },
    [setSearchParams, stream, refreshCounts],
  );

  const closeArticle = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('a');
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  const toggleStar = useCallback(
    async (article: Article) => {
      const next = article.starred ? 0 : 1;
      stream.setItems((items) =>
        items.map((a) => (a.id === article.id ? { ...a, starred: next } : a)),
      );
      if (selected?.id === article.id) setSelected({ ...selected, starred: next });
      await setStarred(article.id, !article.starred);
    },
    [stream, selected],
  );

  const toggleRead = useCallback(
    async (article: Article) => {
      const read = article.read === 0;
      await stream.mark([article.id], read);
      if (selected?.id === article.id) setSelected({ ...selected, read: read ? 1 : 0 });
      await refreshCounts();
    },
    [stream, selected, refreshCounts],
  );

  const markAllRead = useCallback(async () => {
    const ids = stream.items.filter((a) => a.read === 0).map((a) => a.id);
    if (ids.length === 0) return;
    await stream.mark(ids, true);
    await refreshCounts();
    toast(`Marked ${ids.length} read`, 'success');
  }, [stream, refreshCounts, toast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await sendMessage('feeds:refresh', { feedIds });
      await Promise.all([stream.reload(), refreshCounts()]);
      if (res.failed > 0) toast(`${res.failed} feed(s) failed to refresh`, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [feedIds, stream, refreshCounts, toast]);

  const hasSelection = !!selected;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section
        className={`flex w-full flex-col border-r border-[var(--border)] lg:w-[400px] lg:shrink-0 ${
          hasSelection ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
            <p className="truncate text-[11.5px] text-[var(--text-faint)]">{subtitle}</p>
          </div>
          <button
            onClick={() => setUnreadOnly((v) => !v)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              unreadOnly
                ? 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]'
                : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
            }`}
            title="Show unread only"
          >
            Unread
          </button>
          <button
            onClick={markAllRead}
            title="Mark all as read"
            className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
          >
            <IconCheck size={16} />
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Refresh"
            className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
          >
            {refreshing ? <Spinner size={15} /> : <IconRefresh size={16} />}
          </button>
        </header>

        <ArticleList
          items={stream.items}
          selectedId={selectedId}
          loading={stream.loading}
          loadingMore={stream.loadingMore}
          hasMore={stream.hasMore}
          showFeedName={scope.kind !== 'feed'}
          feedById={feedById}
          onSelect={openArticle}
          onToggleStar={(a) => void toggleStar(a)}
          onLoadMore={stream.loadMore}
        />
      </section>

      <section className={`min-w-0 flex-1 ${hasSelection ? 'flex' : 'hidden lg:flex'}`}>
        {selected ? (
          <ArticlePane
            key={selected.id}
            article={selected}
            feed={feedById(selected.feedId)}
            readingFont={settings.readingFont}
            onBack={closeArticle}
            onToggleStar={() => void toggleStar(selected)}
            onToggleRead={() => void toggleRead(selected)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-[13px] text-[var(--text-faint)]">Select an article to read</p>
          </div>
        )}
      </section>
    </div>
  );
}
