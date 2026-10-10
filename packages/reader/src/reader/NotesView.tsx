import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Note } from '@perch/core/notes';
import { relativeTime } from '@perch/core/time';
import { Spinner } from '../components/Spinner';
import { IconExternal, IconNote } from '../components/icons';
import { articleParam } from '../backend';
import { useLibrary } from '../hooks/useLibrary';
import { useNotes } from '../hooks/useNotes';
import { NoteBody, NotePanel, ShareControls } from './NotePanel';

/** Every note, newest first, each with its article. */
export function NotesView() {
  const { notes, loading } = useNotes();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-5">
        <h1 className="text-[15px] font-semibold">Notes</h1>
        <span className="text-[12px] text-[var(--text-faint)]">
          {notes.length > 0 && `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-6">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-[13px] text-[var(--text-muted)]">
              <IconNote size={28} />
              <p className="max-w-[340px]">
                No notes yet. Open an article and press the note button to write down what you
                think. Notes stay private unless you share one.
              </p>
            </div>
          ) : (
            notes.map((note) =>
              editing === note.id ? (
                <NotePanel
                  key={note.id}
                  source={note}
                  editing
                  onEditingChange={(on) => !on && setEditing(null)}
                />
              ) : (
                <NoteCard key={note.id} note={note} onEdit={() => setEditing(note.id)} />
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

function NoteCard({ note, onEdit }: { note: Note; onEdit: () => void }) {
  const { feedById } = useLibrary();
  const followed = !!feedById(note.feedId);
  const ref = { feedId: note.feedId, id: note.articleId };

  return (
    <article className="glass-card mb-4 rounded-[14px] px-4 py-3">
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {note.feedTitle ? `${note.feedTitle} · ` : ''}
        {relativeTime(note.updatedAt)}
      </p>
      <h2 className="mb-2 mt-0.5 text-[15px] font-semibold leading-snug">
        {followed ? (
          <Link
            to={`/feed/${note.feedId}?a=${encodeURIComponent(articleParam(ref))}`}
            className="hover:underline"
          >
            {note.title || 'Untitled'}
          </Link>
        ) : (
          note.title || 'Untitled'
        )}
      </h2>
      <NoteBody markdown={note.body} />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
        <button
          type="button"
          className="font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          onClick={onEdit}
        >
          Edit
        </button>
        {note.url && (
          <a
            href={note.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <IconExternal size={13} /> Original
          </a>
        )}
        <ShareControls note={note} />
      </div>
    </article>
  );
}
