import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { IconButton } from '../components/IconButton';
import { IconCheck, IconRefresh } from '../components/icons';
import { Spinner } from '../components/Spinner';
import { useLibrary } from '../hooks/useLibrary';
import { useSettings } from '../hooks/useSettings';
import { useArticleStream } from '../hooks/useArticleStream';
import {
  articleParam,
  parseArticleParam,
  useBackend,
  type ArticleRef,
  type StreamScope,
} from '../backend';
import { UNCATEGORIZED_ID } from '@perch/core/types';
import type { Article } from '@perch/core/types';
import { ArticleList } from './ArticleList';
import { ArticlePane } from './ArticlePane';
import { useToast } from './Toasts';

type Scope = StreamScope;

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
  const backend = useBackend();
  const { feeds, grouped, feedById, refreshCounts } = useLibrary();
  const { settings } = useSettings();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Article | null>(null);

  const selectedParam = searchParams.get('a');
  const selectedRef = useMemo(() => parseArticleParam(selectedParam), [selectedParam]);
  const selectedId = selectedRef?.id ?? null;
  const query = searchParams.get('q')?.trim() || undefined;

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

  const stream = useArticleStream({ scope, feedIds, unreadOnly, text: query });

  // Resolve the selected article id from the URL into an Article object.
  useEffect(() => {
    if (!selectedRef) {
      setSelected(null);
      return;
    }
    const inList = stream.items.find(
      (a) => a.id === selectedRef.id && a.feedId === selectedRef.feedId,
    );
    if (inList) {
      setSelected(inList);
      return;
    }
    let alive = true;
    void backend.getArticle(selectedRef).then((a) => alive && setSelected(a ?? null));
    return () => {
      alive = false;
    };
  }, [backend, selectedRef, stream.items]);

  const openArticle = useCallback(
    (article: Article) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('a', articleParam(article));
          return next;
        },
        { replace: false },
      );
      if (article.read === 0) {
        void stream.mark([article], true).then(refreshCounts);
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
      await backend.setStarred(article, !article.starred);
    },
    [backend, stream, selected],
  );

  const toggleRead = useCallback(
    async (article: Article) => {
      const read = article.read === 0;
      await stream.mark([article], read);
      if (selected?.id === article.id) setSelected({ ...selected, read: read ? 1 : 0 });
      await refreshCounts();
    },
    [stream, selected, refreshCounts],
  );

  const markAllRead = useCallback(async () => {
    const unread: ArticleRef[] = stream.items.filter((a) => a.read === 0);
    if (unread.length === 0) return;
    await stream.mark(unread, true);
    await refreshCounts();
    toast(`Marked ${unread.length} read`, 'success');
  }, [stream, refreshCounts, toast]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await backend.refresh(feedIds);
      await Promise.all([stream.reload(), refreshCounts()]);
      if (res.failed > 0) toast(`${res.failed} feed(s) failed to refresh`, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [backend, feedIds, stream, refreshCounts, toast]);

  const hasSelection = !!selected;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section
        className={`reader-list flex w-full flex-col border-r border-[var(--border)] lg:w-[400px] lg:shrink-0 ${
          hasSelection ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 backdrop-blur-xl">
          <div className="mr-1 min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold tracking-tight">{title}</h1>
            <p className="truncate text-[11px] text-[var(--text-faint)]">
              {query ? `Results for “${query}”` : subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`h-7 shrink-0 rounded-md px-2 text-[11px] font-medium transition-colors ${
              unreadOnly
                ? 'bg-[var(--button)] text-[var(--button-contrast)]'
                : 'text-[var(--text-faint)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]'
            }`}
            title="Show unread only"
          >
            Unread
          </button>
          <IconButton label="Mark all as read" onClick={markAllRead}>
            <IconCheck size={16} />
          </IconButton>
          <IconButton label="Refresh" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner size={15} /> : <IconRefresh size={16} />}
          </IconButton>
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
          emptyTitle={query ? 'No matches' : undefined}
          emptyHint={
            query
              ? `Nothing in ${title} matches “${query}”${unreadOnly ? ' among unread articles' : ''}.`
              : undefined
          }
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
