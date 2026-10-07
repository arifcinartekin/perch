import { useMemo } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Spinner } from '../components/Spinner';
import { IconArrowLeft, IconExternal, IconRefresh, IconStar, IconCheck } from '../components/icons';
import { sanitizeHtml } from '../lib/sanitize';
import { fullTimestamp } from '@perch/core/time';
import { displayTitle } from '@perch/core/feeds';
import { bareHost } from '@perch/core/url';
import { useFullText } from '../hooks/useFullText';
import type { Article, Feed } from '@perch/core/types';

interface Props {
  article: Article;
  feed: Feed | undefined;
  readingFont: 'sans' | 'serif';
  onBack: () => void;
  onToggleStar: () => void;
  onToggleRead: () => void;
}

export function ArticlePane({
  article,
  feed,
  readingFont,
  onBack,
  onToggleStar,
  onToggleRead,
}: Props) {
  const { state, grant, reload } = useFullText(article);

  const fontFamily = readingFont === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';

  // Feed-provided body — shown immediately and as the fallback if extraction
  // can't run or fails.
  const feedHtml = useMemo(
    () => sanitizeHtml(article.contentHtml || article.summaryHtml || '', { baseUrl: article.url }),
    [article.id, article.contentHtml, article.summaryHtml, article.url],
  );

  const host = (article.url && bareHost(article.url)) || null;
  const extracted = state.status === 'ready' ? state.data.html : null;
  // Offer a manual re-fetch whenever we're settled on something and a URL exists.
  const showReload =
    !!article.url &&
    (state.status === 'ready' || state.status === 'error' || state.status === 'idle');

  return (
    <article className="reader-pane flex h-full flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 backdrop-blur-xl">
        <IconButton className="lg:hidden" label="Back to list" onClick={onBack}>
          <IconArrowLeft size={16} />
        </IconButton>
        <span className="flex-1" />
        {showReload && (
          <IconButton
            label={extracted ? 'Re-fetch full article' : 'Fetch full article text'}
            onClick={() => void reload()}
          >
            <IconRefresh size={15} />
          </IconButton>
        )}
        <IconButton
          label={article.read ? 'Mark unread' : 'Mark read'}
          active={article.read === 0}
          onClick={onToggleRead}
        >
          <IconCheck size={16} />
        </IconButton>
        <IconButton
          label={article.starred ? 'Unstar' : 'Star'}
          active={article.starred === 1}
          onClick={onToggleStar}
        >
          <IconStar size={16} fill={article.starred ? 'currentColor' : 'none'} />
        </IconButton>
        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
            aria-label="Open original"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
          >
            <IconExternal size={16} />
          </a>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-8">
          <p className="mb-2 text-[12px] font-medium text-[var(--text-muted)]">
            {feed ? displayTitle(feed) : ''}
          </p>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text)]">
            {article.url ? (
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {article.title}
              </a>
            ) : (
              article.title
            )}
          </h1>
          <p className="mt-2 text-[12.5px] text-[var(--text-faint)]">
            {article.author ? `${article.author} · ` : ''}
            {fullTimestamp(article.publishedAt)}
            {state.status === 'loading' && (
              <span className="ml-2 inline-flex items-center gap-1 text-[var(--text-faint)]">
                <Spinner size={11} /> loading full article…
              </span>
            )}
          </p>

          <div className="my-5 h-px bg-[var(--border)]" />

          <StatusBar
            state={state}
            host={host}
            hasFeedHtml={!!feedHtml}
            url={article.url}
            onGrant={() => void grant()}
            onRetry={() => void reload()}
          />

          {extracted ? (
            <div
              className="prose-perch"
              style={{ fontFamily }}
              dangerouslySetInnerHTML={{ __html: extracted }}
            />
          ) : feedHtml ? (
            <div
              className="prose-perch"
              style={{ fontFamily }}
              dangerouslySetInnerHTML={{ __html: feedHtml }}
            />
          ) : state.status === 'loading' ? (
            <div className="flex justify-center py-10">
              <Spinner size={18} />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">
              This item has no readable content.{' '}
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open the original
                </a>
              )}
            </p>
          )}

          {article.url && (extracted || feedHtml) && (
            <p className="mt-10 border-t border-[var(--border)] pt-4">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:underline"
              >
                <IconExternal size={14} /> Open original on {host}
              </a>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusBar({
  state,
  host,
  hasFeedHtml,
  url,
  onGrant,
  onRetry,
}: {
  state: ReturnType<typeof useFullText>['state'];
  host: string | null;
  hasFeedHtml: boolean;
  url?: string;
  onGrant: () => void;
  onRetry: () => void;
}) {
  if (state.status === 'blocked') {
    return (
      <Notice>
        <span className="text-[var(--text-muted)]">
          {hasFeedHtml ? 'Showing the feed excerpt. ' : ''}
          The full article lives on {host ?? 'another site'}.
        </span>
        <Button size="sm" variant="default" onClick={onGrant}>
          Load full article
        </Button>
      </Notice>
    );
  }
  if (state.status === 'error') {
    const msg =
      state.reason === 'fetch-failed'
        ? `Couldn’t fetch the page${state.detail ? ` (${state.detail})` : ''}.`
        : state.reason === 'extract-failed'
          ? 'Couldn’t pull a clean article out of that page.'
          : 'Couldn’t load the full article.';
    return (
      <Notice>
        <span className="text-[var(--text-muted)]">{msg}</span>
        <Button size="sm" variant="default" onClick={onRetry}>
          Try again
        </Button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-medium text-[var(--text-muted)] underline hover:text-[var(--text)]"
          >
            Open original
          </a>
        )}
      </Notice>
    );
  }
  return null;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-solid)] px-3.5 py-2.5 text-[12.5px]">
      {children}
    </div>
  );
}
