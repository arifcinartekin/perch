import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Note } from '@perch/core/notes';
import { stateRecordId } from '@perch/core/sync';
import { useBackend, type NoteSource } from '../backend';

// The reader's notes, loaded once and kept current when the backend reports a
// change (another tab, a sync).

export interface NotesValue {
  notes: Note[];
  loading: boolean;
  noteFor: (feedId: string, articleId: string) => Note | undefined;
  save: (source: NoteSource, body: string) => Promise<Note>;
  remove: (noteId: string) => Promise<void>;
  /** Put a note changed outside save/remove (shared, unshared) back in the list. */
  reload: () => Promise<void>;
}

const NotesContext = createContext<NotesValue | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const list = await backend.notes.list().catch(() => null);
    if (list) setNotes(list);
    setLoading(false);
  }, [backend]);

  useEffect(() => {
    void reload();
    return backend.watch({ notes: () => void reload() });
  }, [backend, reload]);

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const value = useMemo<NotesValue>(
    () => ({
      notes,
      loading,
      noteFor: (feedId, articleId) => byId.get(stateRecordId(feedId, articleId)),
      save: async (source, body) => {
        const note = await backend.notes.save(source, body);
        setNotes((list) => [note, ...list.filter((n) => n.id !== note.id)]);
        return note;
      },
      remove: async (noteId) => {
        await backend.notes.remove(noteId);
        setNotes((list) => list.filter((n) => n.id !== noteId));
      },
      reload,
    }),
    [notes, loading, byId, backend, reload],
  );

  return createElement(NotesContext.Provider, { value }, children);
}

export function useNotes(): NotesValue {
  const value = useContext(NotesContext);
  if (!value) throw new Error('useNotes must be used within <NotesProvider>');
  return value;
}
