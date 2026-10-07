import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { useLibrary } from '../hooks/useLibrary';
import { useToast } from './Toasts';
import { displayTitle } from '@perch/core/feeds';
import { useBackend } from '../backend';
import { isHttpUrl, normalizeFeedUrl } from '@perch/core/url';
import type { Feed } from '@perch/core/types';

const NEW = '__new__';

export function FeedEditDialog({ feed, onClose }: { feed: Feed; onClose: () => void }) {
  const backend = useBackend();
  const { categories } = useLibrary();
  const toast = useToast();
  const [title, setTitle] = useState(feed.customTitle ?? '');
  const [url, setUrl] = useState(feed.url);
  const [categoryId, setCategoryId] = useState(feed.categoryId);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlChanged = normalizeFeedUrl(url) !== normalizeFeedUrl(feed.url);

  const save = async () => {
    if (urlChanged && !isHttpUrl(url.trim())) {
      setError('The feed URL must start with http:// or https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const problem = await backend.updateFeed(feed, {
        ...(urlChanged && { url: url.trim() }),
        customTitle: title,
        ...(categoryId === NEW
          ? { category: { newCategory: newCategory || 'New category' } }
          : categoryId !== feed.categoryId && { category: { categoryId } }),
      });
      if (problem) {
        setError(problem);
        return;
      }
      toast(urlChanged ? 'Feed updated — refreshing' : 'Feed updated', 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await backend.removeFeed(feed.id);
      toast('Feed removed', 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const grantAccess = async () => {
    if (!backend.grantFeedAccess) return;
    if (await backend.grantFeedAccess(feed)) {
      toast('Access granted — refreshing', 'success');
      onClose();
    } else {
      toast('Permission was not granted', 'error');
    }
  };

  return (
    <Dialog
      title={`Edit “${displayTitle(feed)}”`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-[var(--text-muted)]">Display name</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={feed.title}
            className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2"
          />
          <span className="text-[11px] text-[var(--text-faint)]">
            Leave blank to use the feed’s own title.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-[var(--text-muted)]">Feed URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[12px]"
          />
          {urlChanged && (
            <span className="text-[11px] text-[var(--text-faint)]">
              Cached articles and read state are kept, and the feed is refreshed.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-[var(--text-muted)]">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New category…</option>
          </select>
        </label>
        {categoryId === NEW && (
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category name"
            className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2"
          />
        )}

        {feed.needsPermission && !urlChanged && backend.grantFeedAccess && (
          <div className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2.5">
            <p className="text-[12px] text-[var(--text-muted)]">
              Perch doesn’t have permission to fetch this feed’s site yet.
            </p>
            <Button size="sm" variant="default" className="mt-2" onClick={grantAccess}>
              Grant access
            </Button>
          </div>
        )}

        {feed.lastError && !feed.needsPermission && (
          <p className="text-[11.5px] text-[#ef4444]">Last refresh failed: {feed.lastError}</p>
        )}
        {error && <p className="text-[11.5px] text-[#ef4444]">{error}</p>}

        <div className="mt-1 border-t border-[var(--border)] pt-3">
          {confirmRemove ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-[var(--text-muted)]">
                Remove this feed and its cached articles?
              </span>
              <Button size="sm" variant="danger" loading={busy} onClick={remove}>
                Remove
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              className="text-[12px] font-medium text-[#ef4444] hover:underline"
            >
              Remove feed
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
