import { useEffect, useRef } from 'react';
import { Favicon } from '../components/Favicon';
import { Spinner } from '../components/Spinner';
import { IconStar } from '../components/icons';
import { excerptOf } from '@perch/core/parser/normalize';
import { relativeTime } from '@perch/core/time';
import { displayTitle } from '@perch/core/feeds';
import type { Article, Feed } from '@perch/core/types';

interface Props {
  items: Article[];
  selectedId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  showFeedName: boolean;
  feedById: (id: string) => Feed | undefined;
  onSelect: (article: Article) => void;
  onToggleStar: (article: Article) => void;
  onLoadMore: () => void;
  /** Override the empty-state copy (e.g. for search). */
  emptyTitle?: string;
  emptyHint?: string;
}

export function ArticleList({
  items,
  selectedId,
  loading,
  loadingMore,
  hasMore,
  showFeedName,
  feedById,
  onSelect,
  onToggleStar,
  onLoadMore,
  emptyTitle = 'Nothing here',
  emptyHint = 'New articles will appear after the next refresh.',
}: Props) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-[13px] font-medium text-[var(--text-muted)]">{emptyTitle}</p>
        <p className="text-[12px] text-[var(--text-faint)]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul>
        {items.map((article) => {
          const feed = feedById(article.feedId);
          const selected = article.id === selectedId;
          return (
            <li key={article.id}>
              <button
                onClick={() => onSelect(article)}
                className={`group flex w-full flex-col gap-1 border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
                    : 'hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
                  {article.read === 0 && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  )}
                  {feed && <Favicon feed={feed} size={13} />}
                  {showFeedName && feed && (
                    <span className="max-w-[45%] truncate font-medium text-[var(--text-muted)]">
                      {displayTitle(feed)}
                    </span>
                  )}
                  <span className="truncate">{relativeTime(article.publishedAt)}</span>
                  <span className="flex-1" />
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(article);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        onToggleStar(article);
                      }
                    }}
                    className={`rounded p-0.5 ${
                      article.starred
                        ? 'text-[var(--text)]'
                        : 'text-transparent group-hover:text-[var(--text-faint)] hover:!text-[var(--text-muted)]'
                    }`}
                    title={article.starred ? 'Unstar' : 'Star'}
                  >
                    <IconStar size={13} fill={article.starred ? 'currentColor' : 'none'} />
                  </span>
                </div>
                <h3
                  className={`text-[13.5px] leading-snug ${
                    article.read === 0
                      ? 'font-semibold text-[var(--text)]'
                      : 'font-medium text-[var(--text-muted)]'
                  }`}
                >
                  {article.title}
                </h3>
                <p className="line-clamp-2 text-[12px] leading-relaxed text-[var(--text-faint)]">
                  {excerptOf(article, 200)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} className="flex h-12 items-center justify-center">
        {loadingMore && <Spinner size={16} />}
      </div>
    </div>
  );
}
