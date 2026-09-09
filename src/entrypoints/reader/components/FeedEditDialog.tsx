import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { Button } from '@/components/Button';
import { useLibrary } from '@/hooks/useLibrary';
import { useToast } from './Toasts';
import { sendMessage } from '@/lib/messaging';
import { addCategory } from '@/lib/storage/categories';
import { moveFeedToCategory, renameFeed, displayTitle } from '@/lib/storage/feeds';
import { requestHostPermission } from '@/lib/permissions/host';
import type { Feed } from '@/lib/types';

const NEW = '__new__';

export function FeedEditDialog({ feed, onClose }: { feed: Feed; onClose: () => void }) {
  const { categories } = useLibrary();
  const toast = useToast();
  const [title, setTitle] = useState(feed.customTitle ?? '');
  const [categoryId, setCategoryId] = useState(feed.categoryId);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await renameFeed(feed.id, title);
      let target = categoryId;
      if (categoryId === NEW) {
        target = (await addCategory(newCategory || 'New category')).id;
      }
      if (target !== feed.categoryId) await moveFeedToCategory(feed.id, target);
      toast('Feed updated', 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await sendMessage('feed:remove', { feedId: feed.id });
      toast('Feed removed', 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const grantAccess = async () => {
    // request() returns true immediately (no prompt) if already granted.
    const granted = await requestHostPermission(feed.url);
    if (granted) {
      await sendMessage('feeds:refresh', { feedIds: [feed.id] });
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

        {feed.needsPermission && (
          <div className="rounded-[9px] border border-[color-mix(in_srgb,#f59e0b_40%,transparent)] bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] px-3 py-2.5">
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
