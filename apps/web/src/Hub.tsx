import { useCallback, useEffect, useState } from 'react';
import type { PublicUser, SharedNoteSummary } from '@perch/core/api';
import { relativeTime } from '@perch/core/time';
import { Button, PerchLogo, Section, Spinner, ToastProvider, useToast } from '@perch/reader';
import { ServerError, api } from './api';
import { WebSettings } from './WebSettings';

// What a hub (app.perch.ws) shows once you're signed in: there's no library
// here, so it's your Perch account: the notes you've shared, and settings.
// Reading happens in the extension and the iPhone app, synced by chain.

export function Hub({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  return (
    <ToastProvider>
      <div className="min-h-screen px-4 py-8 text-[var(--text)]">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">
          <header className="flex items-center justify-between px-1">
            <PerchLogo height={34} />
            <span className="text-[12.5px] text-[var(--text-muted)]">@{user.username}</span>
          </header>

          <div className="glass rounded-[18px] p-5">
            <h1 className="text-[17px] font-semibold">Your Perch account</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
              It’s your name for sharing notes. Your feeds and reading stay on your devices: read in
              the Perch extension or the iPhone app, and link your devices with a sync chain.
            </p>
            <a
              href="https://perch.ws"
              className="mt-3 inline-block text-[13px] font-medium text-[var(--accent-text)] hover:underline"
            >
              Get Perch →
            </a>
          </div>

          <SharedNotes />
          <div className="glass rounded-[18px] p-5">
            <WebSettings user={user} onSignOut={onSignOut} hub />
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

function SharedNotes() {
  const toast = useToast();
  const [items, setItems] = useState<SharedNoteSummary[] | null>(null);
  const load = useCallback(
    () =>
      api<{ shares: SharedNoteSummary[] }>('/shares').then(
        (r) => setItems(r.shares.slice().reverse()),
        () => setItems([]),
      ),
    [],
  );
  useEffect(() => void load(), [load]);

  const unshare = async (noteId: string) => {
    try {
      await api(`/shares/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast(err instanceof ServerError ? err.message : 'Something went wrong. Try again.', 'error');
    }
  };

  return (
    <div className="glass rounded-[18px] p-5">
      <Section title="Shared notes">
        {items === null ? (
          <Spinner size={16} />
        ) : items.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">
            Nothing shared yet. Open an article in Perch, write a note and choose Share.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((s) => (
              <li key={s.slug} className="flex items-center gap-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-medium hover:underline"
                  >
                    {s.title || 'Untitled'}
                  </a>
                  <span className="text-[11.5px] text-[var(--text-faint)]">
                    {s.feedTitle ? `${s.feedTitle} · ` : ''}
                    {relativeTime(s.updatedAt)}
                    {s.hidden ? ' · removed after a report' : ''}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void unshare(s.noteId)}>
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
