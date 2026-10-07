import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { useLibrary } from '../hooks/useLibrary';
import { useToast } from './Toasts';
import { useBackend } from '../backend';
import { isHttpUrl } from '@perch/core/url';
import { UNCATEGORIZED_ID } from '@perch/core/types';

const NEW = '__new__';

export function AddFeedDialog({
  onClose,
  presetCategoryId,
}: {
  onClose: () => void;
  presetCategoryId?: string;
}) {
  const backend = useBackend();
  const { categories } = useLibrary();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [categoryId, setCategoryId] = useState(presetCategoryId ?? UNCATEGORIZED_ID);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const feedUrl = url.trim();
    if (!isHttpUrl(feedUrl)) {
      setError('Enter a full feed URL starting with http:// or https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await backend.addFeed(
        feedUrl,
        categoryId === NEW ? { newCategory: newCategory || 'New category' } : { categoryId },
      );
      toast(result.message, result.created ? 'success' : 'info');
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not add that feed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add a feed"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Add feed
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-[var(--text-muted)]">Feed URL</span>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="https://example.com/feed.xml"
            className="rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2"
          />
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

        <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          {backend.copy.addFeedNote}
        </p>

        {error && <p className="text-[12px] text-[#ef4444]">{error}</p>}
      </div>
    </Dialog>
  );
}
