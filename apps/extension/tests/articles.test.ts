import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  deleteArticlesForFeed,
  listArticles,
  markAllRead,
  pruneFeed,
  setRead,
  setStarred,
  unreadCountsByFeed,
  upsertArticles,
} from '@/lib/storage/articles';
import { __resetDbForTests } from '@/lib/storage/db';
import type { ParsedArticle } from '@perch/core/types';

function mkParsed(n: number, over: Partial<ParsedArticle> = {}): ParsedArticle {
  return {
    title: `Item ${n}`,
    url: `https://example.com/${n}`,
    guid: `guid-${n}`,
    publishedAt: 1_700_000_000_000 + n * 60_000,
    enclosures: [],
    summaryHtml: `<p>Body ${n}</p>`,
    ...over,
  };
}

beforeEach(() => {
  // Fresh in-memory IndexedDB per test; drop the memoised connection too.
  globalThis.indexedDB = new IDBFactory();
  __resetDbForTests();
});

describe('upsertArticles', () => {
  it('inserts new items and reports counts', async () => {
    const res = await upsertArticles('feed-a', [mkParsed(1), mkParsed(2)]);
    expect(res).toEqual({ inserted: 2, updated: 0 });
    const page = await listArticles({ feedIds: ['feed-a'] });
    expect(page.items).toHaveLength(2);
  });

  it('preserves read/starred state when an item is re-fetched', async () => {
    await upsertArticles('feed-a', [mkParsed(1)]);
    const [a] = (await listArticles({ feedIds: ['feed-a'] })).items;
    await setRead([a!.id], true);
    await setStarred(a!.id, true);

    const res = await upsertArticles('feed-a', [mkParsed(1, { title: 'Item 1 (edited)' })]);
    expect(res).toEqual({ inserted: 0, updated: 1 });

    const [updated] = (await listArticles({ feedIds: ['feed-a'] })).items;
    expect(updated!.title).toBe('Item 1 (edited)');
    expect(updated!.read).toBe(1);
    expect(updated!.starred).toBe(1);
  });
});

describe('listArticles', () => {
  beforeEach(async () => {
    const items = Array.from({ length: 25 }, (_, i) => mkParsed(i + 1));
    await upsertArticles('feed-a', items);
    await upsertArticles('feed-b', [mkParsed(100), mkParsed(101)]);
  });

  it('returns newest first', async () => {
    const page = await listArticles({ limit: 5 });
    const times = page.items.map((a) => a.publishedAt);
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it('paginates with the cursor without gaps or repeats', async () => {
    const first = await listArticles({ limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const second = await listArticles({ limit: 10, before: first.nextCursor! });
    const ids = new Set([...first.items, ...second.items].map((a) => a.id));
    expect(ids.size).toBe(20);
  });

  it('filters by feed', async () => {
    const page = await listArticles({ feedIds: ['feed-b'] });
    expect(page.items.map((a) => a.feedId)).toEqual(['feed-b', 'feed-b']);
  });

  it('filters unread only', async () => {
    const all = await listArticles({ limit: 100 });
    await setRead([all.items[0]!.id, all.items[1]!.id], true);
    const unread = await listArticles({ limit: 100, unreadOnly: true });
    expect(unread.items).toHaveLength(25);
  });
});

describe('counts and bulk ops', () => {
  it('unreadCountsByFeed tallies per feed and markAllRead clears them', async () => {
    await upsertArticles('feed-a', [mkParsed(1), mkParsed(2), mkParsed(3)]);
    await upsertArticles('feed-b', [mkParsed(10)]);
    expect(await unreadCountsByFeed()).toEqual({ 'feed-a': 3, 'feed-b': 1 });

    await markAllRead(['feed-a']);
    expect(await unreadCountsByFeed()).toEqual({ 'feed-b': 1 });
  });
});

describe('pruneFeed', () => {
  it('drops old read, non-starred items beyond the keep count', async () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const items = Array.from({ length: 10 }, (_, i) =>
      mkParsed(i + 1, { publishedAt: old + i * 1000 }),
    );
    await upsertArticles('feed-a', items);
    const all = (await listArticles({ feedIds: ['feed-a'], limit: 100 })).items;
    await setRead(
      all.map((a) => a.id),
      true,
    );

    const removed = await pruneFeed('feed-a', { keep: 3, maxAgeDays: 60 });
    expect(removed).toBe(7);
    const left = await listArticles({ feedIds: ['feed-a'], limit: 100 });
    expect(left.items).toHaveLength(3);
  });

  it('keeps unread and starred items even when old', async () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    await upsertArticles('feed-a', [
      mkParsed(1, { publishedAt: old }),
      mkParsed(2, { publishedAt: old }),
    ]);
    const removed = await pruneFeed('feed-a', { keep: 0, maxAgeDays: 60 });
    expect(removed).toBe(0);
  });
});

describe('deleteArticlesForFeed', () => {
  it('removes every article for the feed', async () => {
    await upsertArticles('feed-a', [mkParsed(1), mkParsed(2)]);
    await upsertArticles('feed-b', [mkParsed(3)]);
    await deleteArticlesForFeed('feed-a');
    expect((await listArticles({ limit: 100 })).items.map((a) => a.feedId)).toEqual(['feed-b']);
  });
});

describe('listArticles text search', () => {
  it('matches every term across title, author and body, ignoring case and accents', async () => {
    await upsertArticles('feed-a', [
      mkParsed(1, { title: 'İstanbul’da yeni metro hattı' }),
      mkParsed(2, { title: 'Café culture', author: 'Ada Lovelace' }),
      mkParsed(3, { title: 'Weekly notes', contentHtml: '<p>Rust <b>async</b> runtimes</p>' }),
    ]);
    const titles = async (text: string) => (await listArticles({ text })).items.map((a) => a.title);

    expect(await titles('istanbul METRO')).toEqual(['İstanbul’da yeni metro hattı']);
    expect(await titles('hatti')).toEqual(['İstanbul’da yeni metro hattı']);
    expect(await titles('cafe lovelace')).toEqual(['Café culture']);
    expect(await titles('rust async')).toEqual(['Weekly notes']);
    expect(await titles('rust python')).toEqual([]);
  });

  it('does not match markup inside HTML tags', async () => {
    await upsertArticles('feed-a', [mkParsed(1, { summaryHtml: '<a href="x">link</a>' })]);
    expect((await listArticles({ text: 'href' })).items).toHaveLength(0);
    expect((await listArticles({ text: 'link' })).items).toHaveLength(1);
  });

  it('paginates search results', async () => {
    await upsertArticles(
      'feed-a',
      Array.from({ length: 30 }, (_, i) =>
        mkParsed(i, { title: i % 2 ? `odd ${i}` : `even ${i}` }),
      ),
    );
    const first = await listArticles({ text: 'odd', limit: 10 });
    expect(first.items).toHaveLength(10);
    const second = await listArticles({ text: 'odd', limit: 10, before: first.nextCursor! });
    expect(second.items).toHaveLength(5);
    expect(second.items.every((a) => a.title.startsWith('odd'))).toBe(true);
  });
});
