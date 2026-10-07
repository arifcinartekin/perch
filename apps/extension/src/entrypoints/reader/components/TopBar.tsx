import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { IconButton } from '@/components/IconButton';
import { IconRefresh, IconRss, IconSearch, IconSettings, IconX } from '@/components/icons';
import { Spinner } from '@/components/Spinner';
import { useLibrary } from '@/hooks/useLibrary';
import { displayTitle } from '@/lib/storage/feeds';
import { sendMessage } from '@/lib/messaging';
import { useToast } from './Toasts';

const DEBOUNCE_MS = 200;

/**
 * Full-width bar across the top of the reader: brand, the article search, and
 * the global actions. The query lives in the URL (`?q=`) of the current stream,
 * so it scopes to whatever feed / category is open and survives reloads.
 */
export function TopBar() {
  const { feedById, grouped, refreshCounts } = useLibrary();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';

  const [value, setValue] = useState(urlQuery);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow the URL when it changes from elsewhere (sidebar navigation, back button).
  useEffect(() => {
    if (document.activeElement !== inputRef.current || urlQuery === '') setValue(urlQuery);
  }, [urlQuery]);

  const commit = (q: string) => {
    clearTimeout(timer.current);
    const trimmed = q.trim();
    if (pathname === '/settings') {
      if (trimmed) navigate(`/?q=${encodeURIComponent(trimmed)}`);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) next.set('q', trimmed);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  };

  const onChange = (q: string) => {
    setValue(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(q), DEBOUNCE_MS);
  };

  const clear = () => {
    setValue('');
    commit('');
  };

  // "/" or Cmd/Ctrl+K focuses the search from anywhere in the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const res = await sendMessage('feeds:refresh', {});
      await refreshCounts();
      toast(
        res.failed > 0
          ? `Refreshed ${res.refreshed}, ${res.failed} failed`
          : `Refreshed ${res.refreshed} feed${res.refreshed === 1 ? '' : 's'}`,
        res.failed > 0 ? 'error' : 'success',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const scopeLabel = (() => {
    const feedId = matchPath('/feed/:id', pathname)?.params.id;
    if (feedId) {
      const feed = feedById(feedId);
      return feed ? displayTitle(feed) : 'this feed';
    }
    const catId = matchPath('/category/:id', pathname)?.params.id;
    if (catId)
      return grouped.find((g) => g.category.id === catId)?.category.name ?? 'this category';
    if (pathname === '/starred') return 'Starred';
    return 'all feeds';
  })();

  return (
    <header className="relative z-10 flex h-12 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-elevated)] backdrop-blur-xl">
      <div className="flex w-[264px] shrink-0 items-center gap-2 px-4">
        <IconRss size={17} className="shrink-0 text-[var(--accent)]" />
        <span className="text-[14px] font-semibold tracking-tight">Perch</span>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-3">
        <label className="group relative flex h-8 w-full max-w-[560px] items-center">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-2.5 text-[var(--text-faint)]"
          />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(value);
              if (e.key === 'Escape') {
                e.preventDefault();
                if (value) clear();
                else inputRef.current?.blur();
              }
            }}
            placeholder={`Search ${scopeLabel}`}
            aria-label="Search articles"
            spellCheck={false}
            className="h-full w-full rounded-[9px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] pl-8 pr-14 text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:bg-[var(--bg-solid)] [&::-webkit-search-cancel-button]:hidden"
          />
          {value ? (
            <button
              type="button"
              onClick={clear}
              title="Clear search"
              aria-label="Clear search"
              className="absolute right-1.5 rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
            >
              <IconX size={13} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 rounded border border-[var(--border-strong)] px-1.5 font-sans text-[10.5px] text-[var(--text-faint)] group-focus-within:hidden">
              /
            </kbd>
          )}
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-3">
        <IconButton label="Refresh all feeds" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? <Spinner size={15} /> : <IconRefresh size={16} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => navigate('/settings')}>
          <IconSettings size={16} />
        </IconButton>
      </div>
    </header>
  );
}
