import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import {
  IconExternal,
  IconPlus,
  IconRss,
  IconSearch,
  IconSettings,
  IconX,
} from '@/components/icons';
import { sendMessage } from '@/lib/messaging';
import { feedByUrl } from '@/lib/storage/feeds';
import { getCategories } from '@/lib/storage/categories';
import { requestHostPermission } from '@/lib/permissions/host';
import { useSettings } from '@/hooks/useSettings';
import { useApplyTheme } from '@/hooks/useTheme';
import { bareHost, isHttpUrl } from '@/lib/util/url';
import type { Category, DiscoveredFeed, TabDiscovery } from '@/lib/types';
import { UNCATEGORIZED_ID } from '@/lib/types';

type Phase = 'loading' | 'ready';

export function App() {
  const { settings } = useSettings();
  useApplyTheme(settings.theme);

  const [phase, setPhase] = useState<Phase>('loading');
  const [tabId, setTabId] = useState<number | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<TabDiscovery | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState(UNCATEGORIZED_ID);
  const [rescanning, setRescanning] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [manualUrl, setManualUrl] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id ?? null);
      setPageUrl(tab?.url ?? null);
      const [cats, disc] = await Promise.all([
        getCategories(),
        sendMessage('discovery:get', { tabId: tab?.id }).catch(() => null),
      ]);
      setCategories(cats);
      setDiscovery(disc);
      setPhase('ready');
    })();
  }, []);

  const rescan = useCallback(async () => {
    if (tabId == null) return;
    setRescanning(true);
    setNote(null);
    try {
      const disc = await sendMessage('discovery:rescan', { tabId });
      setDiscovery(disc);
      if (disc && disc.feeds.length === 0) setNote('No feeds found on this page.');
    } finally {
      setRescanning(false);
    }
  }, [tabId]);

  const refreshDiscovery = useCallback(async () => {
    if (tabId == null) return;
    const disc = await sendMessage('discovery:rescan', { tabId }).catch(() => null);
    if (disc) setDiscovery(disc);
  }, [tabId]);

  const addFeed = useCallback(
    async (df: Pick<DiscoveredFeed, 'url' | 'title'>) => {
      setBusy((b) => ({ ...b, [df.url]: true }));
      setNote(null);
      try {
        const granted = await requestHostPermission(df.url);
        await sendMessage('feed:add', {
          url: df.url,
          title: df.title,
          siteUrl: discovery?.pageUrl ?? pageUrl ?? undefined,
          iconUrl: discovery?.iconHref,
          categoryId,
          needsPermission: !granted,
        });
        if (!granted) {
          setNote(
            'Added, but Perch needs permission to fetch this feed. Open it in the reader to grant access.',
          );
        }
        await refreshDiscovery();
      } finally {
        setBusy((b) => ({ ...b, [df.url]: false }));
      }
    },
    [categoryId, discovery?.pageUrl, pageUrl, refreshDiscovery],
  );

  const removeFeed = useCallback(
    async (df: Pick<DiscoveredFeed, 'url'>) => {
      setBusy((b) => ({ ...b, [df.url]: true }));
      try {
        const existing = await feedByUrl(df.url);
        if (existing) await sendMessage('feed:remove', { feedId: existing.id });
        await refreshDiscovery();
      } finally {
        setBusy((b) => ({ ...b, [df.url]: false }));
      }
    },
    [refreshDiscovery],
  );

  const openReader = useCallback(async () => {
    await sendMessage('reader:open');
    window.close();
  }, []);

  const openSettings = useCallback(async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('/reader.html#/settings') });
    window.close();
  }, []);

  const addManual = useCallback(async () => {
    const url = manualUrl.trim();
    if (!isHttpUrl(url)) {
      setNote('Enter a full feed URL starting with http:// or https://');
      return;
    }
    await addFeed({ url });
    setManualUrl('');
  }, [manualUrl, addFeed]);

  const { newFeeds, addedFeeds } = useMemo(() => {
    const feeds = discovery?.feeds ?? [];
    return {
      newFeeds: feeds.filter((f) => !f.alreadyAdded),
      addedFeeds: feeds.filter((f) => f.alreadyAdded),
    };
  }, [discovery]);

  const host = pageUrl ? bareHost(pageUrl) : null;
  const restricted = pageUrl != null && !isHttpUrl(pageUrl);

  return (
    <div className="flex max-h-[560px] flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
        <IconRss size={18} className="text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">Perch</div>
          <div className="truncate text-[11px] text-[var(--text-faint)]">
            {restricted ? 'This page can’t be scanned' : (host ?? 'No active page')}
          </div>
        </div>
        <button
          onClick={openSettings}
          className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
          title="Settings"
        >
          <IconSettings size={16} />
        </button>
        <button
          onClick={() => window.close()}
          className="rounded-md p-1.5 text-[var(--text-faint)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)]"
          title="Close"
        >
          <IconX size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        {phase === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--text-muted)]">
            <Spinner /> Scanning this page…
          </div>
        ) : restricted ? (
          <p className="py-6 text-center text-[12.5px] text-[var(--text-muted)]">
            Browser and extension pages can’t be scanned for feeds. Try a normal website.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                {newFeeds.length > 0
                  ? `${newFeeds.length} feed${newFeeds.length > 1 ? 's' : ''} found`
                  : 'Feed discovery'}
              </span>
              <Button size="sm" variant="ghost" onClick={rescan} loading={rescanning}>
                <IconSearch size={14} /> Search for RSS feeds
              </Button>
            </div>

            {newFeeds.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                  Add to
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2 py-1 text-[12px]"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {newFeeds.map((f) => (
                  <FeedRow
                    key={f.url}
                    feed={f}
                    busy={!!busy[f.url]}
                    action="add"
                    onAction={() => addFeed(f)}
                  />
                ))}
              </div>
            )}

            {addedFeeds.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                  In your reader
                </span>
                {addedFeeds.map((f) => (
                  <FeedRow
                    key={f.url}
                    feed={f}
                    busy={!!busy[f.url]}
                    action="remove"
                    onAction={() => removeFeed(f)}
                  />
                ))}
              </div>
            )}

            {newFeeds.length === 0 && addedFeeds.length === 0 && (
              <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] px-3 py-4 text-center">
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  No feeds detected on this page.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="Paste a feed URL"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2 py-1.5 text-[12px]"
                  />
                  <Button size="sm" variant="primary" onClick={addManual}>
                    <IconPlus size={14} /> Add
                  </Button>
                </div>
              </div>
            )}

            {note && (
              <p className="rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-2 text-[11.5px] text-[var(--text-muted)]">
                {note}
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--border)] p-2.5">
        <Button variant="primary" className="w-full" onClick={openReader}>
          <IconExternal size={15} /> Open RSS Reader
        </Button>
      </footer>
    </div>
  );
}

function FeedRow({
  feed,
  busy,
  action,
  onAction,
}: {
  feed: DiscoveredFeed;
  busy: boolean;
  action: 'add' | 'remove';
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-solid)] px-2.5 py-2">
      <IconRss size={14} className="shrink-0 text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">
          {feed.title || feedLabel(feed.url)}
        </div>
        <div className="truncate text-[11px] text-[var(--text-faint)]">{feedLabel(feed.url)}</div>
      </div>
      <Button
        size="sm"
        variant={action === 'add' ? 'primary' : 'danger'}
        loading={busy}
        onClick={onAction}
      >
        {action === 'add' ? 'Add to reader' : 'Remove'}
      </Button>
    </div>
  );
}

function feedLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}
