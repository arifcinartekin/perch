import { useMemo } from 'react';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import {
  IconArrowLeft,
  IconExternal,
  IconGlobe,
  IconBook,
  IconStar,
  IconCheck,
} from '@/components/icons';
import { sanitizeHtml } from '@/lib/sanitize';
import { fullTimestamp } from '@/lib/util/time';
import { displayTitle } from '@/lib/storage/feeds';
import { useFullText } from '@/hooks/useFullText';
import type { Article, ArticleViewMode, Feed } from '@/lib/types';

interface Props {
  article: Article;
  feed: Feed | undefined;
  viewMode: ArticleViewMode;
  readingFont: 'sans' | 'serif';
  onBack: () => void;
  onSetViewMode: (mode: ArticleViewMode) => void;
  onToggleStar: () => void;
  onToggleRead: () => void;
}

export function ArticlePane({
  article,
  feed,
  viewMode,
  readingFont,
  onBack,
  onSetViewMode,
  onToggleStar,
  onToggleRead,
}: Props) {
  const wantFullText = viewMode === 'fulltext';
  const { state, run } = useFullText(article, wantFullText);

  const summaryHtml = useMemo(
    () =>
      sanitizeHtml(article.contentHtml || article.summaryHtml || '', {
        baseUrl: article.url,
      }),
    [article.id, article.contentHtml, article.summaryHtml, article.url],
  );

  const fullTextHtml = state.status === 'ready' ? state.data.html : null;

  return (
    <article className="flex h-full flex-1 flex-col bg-[var(--bg)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 backdrop-blur-xl">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)] lg:hidden"
          title="Back to list"
        >
          <IconArrowLeft size={16} />
        </button>

        <div className="flex overflow-hidden rounded-[9px] border border-[var(--border-strong)]">
          <ModeButton
            active={viewMode === 'summary'}
            onClick={() => onSetViewMode('summary')}
            icon={<IconGlobe size={13} />}
            label="Summary"
          />
          <ModeButton
            active={viewMode === 'fulltext'}
            onClick={() => onSetViewMode('fulltext')}
            icon={<IconBook size={13} />}
            label="Full text"
          />
        </div>

        <span className="flex-1" />

        <button
          onClick={onToggleRead}
          title={article.read ? 'Mark unread' : 'Mark read'}
          className={`rounded-md p-1.5 hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] ${
            article.read ? 'text-[var(--text-faint)]' : 'text-[var(--accent)]'
          }`}
        >
          <IconCheck size={16} />
        </button>
        <button
          onClick={onToggleStar}
          title={article.starred ? 'Unstar' : 'Star'}
          className={`rounded-md p-1.5 hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] ${
            article.starred ? 'text-[#f59e0b]' : 'text-[var(--text-faint)]'
          }`}
        >
          <IconStar size={16} />
        </button>
        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
            className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
          >
            <IconExternal size={16} />
          </a>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-8">
          <p className="mb-2 text-[12px] font-medium text-[var(--accent)]">
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
          </p>

          <div className="my-5 h-px bg-[var(--border)]" />

          {viewMode === 'summary' ? (
            <SummaryBody html={summaryHtml} url={article.url} font={readingFont} />
          ) : (
            <FullTextBody
              status={state.status}
              html={fullTextHtml}
              reason={state.status === 'error' ? state.reason : undefined}
              detail={state.status === 'error' ? state.detail : undefined}
              url={article.url}
              font={readingFont}
              onRetry={() => run({ force: true })}
              onStart={() => run()}
              fallbackHtml={summaryHtml}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
          : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SummaryBody({ html, url, font }: { html: string; url?: string; font: 'sans' | 'serif' }) {
  if (!html) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        This item has no summary.{' '}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline"
          >
            Open the original
          </a>
        )}
        .
      </p>
    );
  }
  return (
    <>
      <div
        className="prose-perch"
        style={{ fontFamily: font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {url && (
        <p className="mt-8 border-t border-[var(--border)] pt-4">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--accent)] hover:underline"
          >
            <IconExternal size={14} /> Read the full article on the site
          </a>
        </p>
      )}
    </>
  );
}

function FullTextBody({
  status,
  html,
  reason,
  detail,
  url,
  font,
  onRetry,
  onStart,
  fallbackHtml,
}: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  html: string | null;
  reason?: string;
  detail?: string;
  url?: string;
  font: 'sans' | 'serif';
  onRetry: () => void;
  onStart: () => void;
  fallbackHtml: string;
}) {
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-[var(--text-muted)]">
          Fetch the full article text from the original page. Perch will ask for permission to
          access this one site the first time.
        </p>
        <Button variant="primary" onClick={onStart}>
          <IconBook size={14} /> Load full text
        </Button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Spinner size={16} /> Fetching and extracting…
      </div>
    );
  }

  if (status === 'error') {
    const message =
      reason === 'permission-denied'
        ? 'Permission to access this site was not granted.'
        : reason === 'fetch-failed'
          ? `Couldn’t fetch the page${detail ? ` (${detail})` : ''}.`
          : reason === 'no-url'
            ? 'This item has no link to fetch.'
            : 'Couldn’t extract readable content from this page.';
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-[#ef4444]">{message}</p>
        <div className="flex gap-2">
          {reason !== 'no-url' && (
            <Button variant="default" onClick={onRetry}>
              Try again
            </Button>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border-strong)] px-3.5 py-2 text-[13px] font-medium hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
            >
              <IconExternal size={14} /> Open original
            </a>
          )}
        </div>
        {fallbackHtml && (
          <div className="mt-4 w-full border-t border-[var(--border)] pt-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
              Feed summary
            </p>
            <div
              className="prose-perch"
              style={{ fontFamily: font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)' }}
              dangerouslySetInnerHTML={{ __html: fallbackHtml }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="prose-perch"
      style={{ fontFamily: font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)' }}
      dangerouslySetInnerHTML={{ __html: html ?? '' }}
    />
  );
}
