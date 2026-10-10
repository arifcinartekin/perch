import { useEffect, useMemo, useRef, useState } from 'react';
import { NOTE_MAX, renderNote, type Note } from '@perch/core/notes';
import { relativeTime } from '@perch/core/time';
import { Button } from '../components/Button';
import { IconLink } from '../components/icons';
import { useBackend, type NoteSource } from '../backend';
import { useNotes } from '../hooks/useNotes';
import { sanitizeHtml } from '../lib/sanitize';
import { useToast } from './Toasts';

// The note on an article: shown under the article's title, edited in place
// (markdown, saved as you type), and shared as a public page.

const SAVE_DELAY = 800;

export function NotePanel({
  source,
  editing,
  onEditingChange,
}: {
  source: NoteSource;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const { noteFor, save, remove } = useNotes();
  const toast = useToast();
  const note = noteFor(source.feedId, source.articleId);
  const [draft, setDraft] = useState(note?.body ?? '');
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSaved = useRef(note?.body ?? '');

  // Another device or tab changed the note while it isn't being edited.
  useEffect(() => {
    if (!editing) {
      setDraft(note?.body ?? '');
      lastSaved.current = note?.body ?? '';
    }
  }, [note?.body, editing]);

  const flush = async (body = draft) => {
    clearTimeout(timer.current);
    if (body === lastSaved.current || (!body.trim() && !note)) return note;
    setStatus('saving');
    try {
      const saved = await save(source, body);
      lastSaved.current = body;
      setStatus('saved');
      return saved;
    } catch (err) {
      setStatus('error');
      toast(`Couldn’t save the note: ${(err as Error).message}`, 'error');
      return undefined;
    }
  };

  // Save when typing pauses, and whatever is left when the panel goes away.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const onChange = (value: string) => {
    setDraft(value);
    setStatus('idle');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(value), SAVE_DELAY);
  };

  const done = async () => {
    await flush();
    setPreview(false);
    onEditingChange(false);
  };

  const deleteNote = async () => {
    clearTimeout(timer.current);
    if (note) {
      await remove(note.id).catch((err) =>
        toast(`Couldn’t delete the note: ${(err as Error).message}`, 'error'),
      );
    }
    setDraft('');
    lastSaved.current = '';
    onEditingChange(false);
  };

  if (!editing && !note) return null;

  return (
    <section
      aria-label="Your note"
      className="glass-card mb-6 rounded-[14px] border-l-[3px] border-l-[var(--accent)] px-4 py-3"
    >
      <div className="mb-2 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        <span className="flex-1">Your note</span>
        {editing ? (
          <>
            <span className="font-normal normal-case tracking-normal">
              {status === 'saving'
                ? 'Saving…'
                : status === 'saved'
                  ? 'Saved'
                  : status === 'error'
                    ? 'Not saved'
                    : ''}
            </span>
            <button
              type="button"
              className="normal-case tracking-normal text-[var(--text-muted)] hover:text-[var(--text)]"
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Write' : 'Preview'}
            </button>
          </>
        ) : (
          note && (
            <span className="font-normal normal-case tracking-normal">
              {relativeTime(note.updatedAt)}
            </span>
          )
        )}
      </div>

      {editing && !preview ? (
        <textarea
          autoFocus
          value={draft}
          maxLength={NOTE_MAX}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              void done();
            }
          }}
          placeholder="Write your thoughts. Markdown works: **bold**, _italic_, > quote, - list, [link](https://…)"
          className="min-h-[140px] w-full resize-y rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-solid)] p-3 text-[14px] leading-relaxed outline-none focus:border-[var(--accent)]"
        />
      ) : (
        <NoteBody markdown={editing ? draft : (note?.body ?? '')} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button size="sm" variant="primary" onClick={() => void done()}>
              Done
            </Button>
            {(note || draft) && (
              <Button size="sm" variant="ghost" onClick={() => void deleteNote()}>
                Delete note
              </Button>
            )}
            <span className="ml-auto text-[11px] text-[var(--text-faint)]">
              {draft.length.toLocaleString()} / {NOTE_MAX.toLocaleString()}
            </span>
          </>
        ) : (
          <Button size="sm" variant="default" onClick={() => onEditingChange(true)}>
            Edit
          </Button>
        )}
        {note && <ShareControls note={note} beforeShare={flush} />}
      </div>
    </section>
  );
}

/** A note's markdown, rendered safely. */
export function NoteBody({ markdown }: { markdown: string }) {
  const html = useMemo(() => sanitizeHtml(renderNote(markdown)), [markdown]);
  if (!markdown.trim()) {
    return <p className="text-[13px] text-[var(--text-faint)]">Nothing written yet.</p>;
  }
  return (
    <div
      className="prose-perch prose-note text-[14.5px]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Share / copy link / stop sharing. */
export function ShareControls({
  note,
  beforeShare,
}: {
  note: Note;
  /** Save pending edits first, so the page shows them. */
  beforeShare?: () => Promise<Note | undefined>;
}) {
  const backend = useBackend();
  const { reload } = useNotes();
  const toast = useToast();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void backend.sharing.unavailable().then((reason) => alive && setBlocked(reason));
    return () => {
      alive = false;
    };
  }, [backend]);

  const copy = async (url: string) => {
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast('Link copied', 'success');
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (note.sharedUrl) {
    const url = note.sharedUrl;
    return (
      <span className="ml-auto flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
        >
          <IconLink size={13} /> Shared
        </a>
        <Button size="sm" variant="ghost" onClick={() => void copy(url)}>
          Copy link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => void run(() => backend.sharing.unshare(note.id))}
        >
          Stop sharing
        </Button>
      </span>
    );
  }

  return (
    <span className="ml-auto flex items-center gap-2">
      {blocked && <span className="text-[11.5px] text-[var(--text-faint)]">{blocked}</span>}
      <Button
        size="sm"
        variant="default"
        loading={busy}
        disabled={!!blocked || !note.body.trim()}
        onClick={() =>
          void run(async () => {
            await beforeShare?.();
            const url = await backend.sharing.share(note.id);
            await copy(url);
          })
        }
      >
        <IconLink size={13} /> Share
      </Button>
    </span>
  );
}
