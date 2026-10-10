import type { Note, NoteRecordData } from '@perch/core/notes';
import { stateRecordId } from '@perch/core/sync';
import { getLocal, setLocal, watchLocal, KEYS } from './local';

// Notes on articles, keyed by note id (feedId:articleId). Few and small, so
// they live in storage.local next to the feed list and sync like it.

export type NoteMap = Record<string, NoteRecordData>;

export const getNoteMap = () => getLocal<NoteMap>(KEYS.notes, {});

export const saveNoteMap = (notes: NoteMap) => setLocal(KEYS.notes, notes);

export async function listNotes(): Promise<Note[]> {
  return Object.entries(await getNoteMap())
    .map(([id, d]) => ({ ...d, id }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putNote(
  source: Pick<NoteRecordData, 'feedId' | 'articleId' | 'title' | 'url' | 'feedTitle'>,
  body: string,
): Promise<Note> {
  const notes = await getNoteMap();
  const id = stateRecordId(source.feedId, source.articleId);
  const existing = notes[id];
  const now = Date.now();
  const data: NoteRecordData = {
    feedId: source.feedId,
    articleId: source.articleId,
    title: source.title,
    ...(source.url && { url: source.url }),
    ...(source.feedTitle && { feedTitle: source.feedTitle }),
    body,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.sharedUrl && { sharedUrl: existing.sharedUrl }),
  };
  await saveNoteMap({ ...notes, [id]: data });
  return { ...data, id };
}

export async function deleteNote(id: string): Promise<void> {
  const { [id]: _gone, ...rest } = await getNoteMap();
  await saveNoteMap(rest);
}

/** Record (or clear) the note's public link; it syncs like the rest of the note. */
export async function setSharedUrl(id: string, sharedUrl: string | undefined): Promise<void> {
  const notes = await getNoteMap();
  const note = notes[id];
  if (!note || note.sharedUrl === sharedUrl) return;
  const { sharedUrl: _old, ...rest } = note;
  await saveNoteMap({ ...notes, [id]: { ...rest, ...(sharedUrl && { sharedUrl }) } });
}

export const watchNotes = (fn: () => void) => watchLocal(KEYS.notes, fn);
