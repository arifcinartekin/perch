import type { FullText } from '@perch/core/types';
import { getDB } from './db';

const MAX_ENTRIES = 400;

export async function getFullText(articleId: string): Promise<FullText | undefined> {
  return (await getDB()).get('fulltext', articleId);
}

export async function saveFullText(entry: FullText): Promise<void> {
  const db = await getDB();
  await db.put('fulltext', entry);
  void trim();
}

export async function deleteFullText(articleId: string): Promise<void> {
  await (await getDB()).delete('fulltext', articleId);
}

export async function clearFullText(): Promise<void> {
  await (await getDB()).clear('fulltext');
}

/** Evict the oldest extractions once the cache grows past MAX_ENTRIES. */
async function trim(): Promise<void> {
  const db = await getDB();
  const count = await db.count('fulltext');
  if (count <= MAX_ENTRIES) return;
  const tx = db.transaction('fulltext', 'readwrite');
  let cursor = await tx.store.index('by-extracted').openCursor();
  let toRemove = count - MAX_ENTRIES;
  while (cursor && toRemove > 0) {
    await cursor.delete();
    toRemove--;
    cursor = await cursor.continue();
  }
  await tx.done;
}
