import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { feedIdFor } from '@perch/core/feeds';
import {
  compareHlc,
  recordKey,
  type StoredRecord,
  type SyncPushRequest,
  type SyncRecord,
} from '@perch/core/sync';
import type { ParsedArticle } from '@perch/core/types';

// Two "devices" (separate storage.local and IndexedDB, separate module
// instances) syncing through an in-memory server that follows the protocol:
// per-key last-writer-wins by clock, increasing versions. The real server's
// side of the protocol is tested in apps/server.

// The mock is created once, so it reads whichever device is active (see device()).
vi.mock('wxt/browser', () => {
  const current = () => (globalThis as any).__deviceStore as Map<string, unknown>;
  const listeners = new Set<(changes: object, area: string) => void>();
  return {
    browser: {
      storage: {
        local: {
          get: async (key: string) => {
            const store = current();
            return store.has(key) ? { [key]: structuredClone(store.get(key)) } : {};
          },
          set: async (items: Record<string, unknown>) => {
            const store = current();
            const changes: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: store.get(k), newValue: v };
              store.set(k, structuredClone(v));
            }
            listeners.forEach((l) => l(changes, 'local'));
          },
        },
        onChanged: {
          addListener: (l: any) => listeners.add(l),
          removeListener: (l: any) => listeners.delete(l),
        },
      },
      permissions: { contains: async () => false },
    },
  };
});

// ---------------------------------------------------------------------------
// Fake server
// ---------------------------------------------------------------------------

function fakeServer() {
  const records = new Map<string, StoredRecord>();
  let version = 0;
  const handle = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname.endsWith('/sync/changes')) {
      const since = Number(url.searchParams.get('since'));
      const limit = Number(url.searchParams.get('limit'));
      const all = [...records.values()]
        .filter((r) => r.version > since)
        .sort((a, b) => a.version - b.version);
      const page = all.slice(0, limit);
      return json({
        records: page,
        cursor: page.at(-1)?.version ?? since,
        more: all.length > limit,
      });
    }
    if (url.pathname.endsWith('/sync/push')) {
      const body = JSON.parse(String(init?.body)) as SyncPushRequest;
      const results = body.records.map((r: SyncRecord) => {
        const key = recordKey(r.type, r.id);
        const existing = records.get(key);
        if (existing && compareHlc(r.hlc, existing.hlc) <= 0) {
          return { key, status: 'stale', version: existing.version };
        }
        records.set(key, { ...r, version: ++version });
        return { key, status: 'ok', version };
      });
      return json({ results, cursor: version });
    }
    return new Response('{}', { status: 404 });
  };
  return { records, handle };
}

const server = fakeServer();
globalThis.fetch = ((input: string, init?: RequestInit) =>
  server.handle(input, init)) as typeof fetch;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

async function device(node: string) {
  const store = new Map<string, unknown>();
  const idb = new IDBFactory();
  (globalThis as any).__deviceStore = store;
  globalThis.indexedDB = idb;
  vi.resetModules();
  const [engine, state, feeds, categories, settings, articles, db] = await Promise.all([
    import('@/lib/sync/engine'),
    import('@/lib/sync/state'),
    import('@/lib/storage/feeds'),
    import('@/lib/storage/categories'),
    import('@/lib/storage/settings'),
    import('@/lib/storage/articles'),
    import('@/lib/storage/db'),
  ]);
  await db.getDB(); // bind this module instance to this device's IndexedDB

  // Every call made through the returned object runs against this device's
  // storage. Tests await each call, so devices never interleave.
  const activate = () => {
    (globalThis as any).__deviceStore = store;
    globalThis.indexedDB = idb;
  };
  const bind = <T extends object>(mod: T): T =>
    new Proxy(mod, {
      get(target, prop) {
        const value = (target as any)[prop];
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              activate();
              return value(...args);
            }
          : value;
      },
    });
  return {
    engine: bind(engine),
    state: bind(state),
    feeds: bind(feeds),
    categories: bind(categories),
    settings: bind(settings),
    articles: bind(articles),
    signIn: () => {
      activate();
      return state.saveAccount({ server: 'https://perch.test', username: 'me', token: 't', node });
    },
    sync: () => {
      activate();
      return engine.syncNow();
    },
  };
}

const item = (guid: string): ParsedArticle => ({
  guid,
  title: `Item ${guid}`,
  url: `https://blog.example/${guid}`,
  publishedAt: Date.parse('2026-10-01T00:00:00Z'),
  enclosures: [],
});

const FEED_URL = 'https://blog.example/feed.xml';
const FEED_ID = feedIdFor(FEED_URL);

describe('extension sync engine', () => {
  beforeEach(() => {
    server.records.clear();
  });

  it('moves the library from one device to another and adopts the account settings', async () => {
    const laptop = await device('laptop');
    await laptop.feeds.addFeed({ url: FEED_URL, title: 'Blog' });
    const tech = await laptop.categories.addCategory('Tech');
    await laptop.feeds.moveFeedToCategory(FEED_ID, tech.id);
    await laptop.settings.saveSettings({ theme: 'dark' });
    await laptop.signIn();
    const first = await laptop.sync();
    expect(first?.pushed).toBeGreaterThan(0);

    // Nothing changed since: the next round pushes nothing.
    expect((await laptop.sync())?.pushed).toBe(0);

    const phone = await device('phone');
    await phone.settings.saveSettings({ theme: 'light' }); // set before joining
    await phone.feeds.addFeed({ url: 'https://only.phone/rss', title: 'Phone only' });
    await phone.signIn();
    const res = await phone.sync();
    expect(res?.newFeedIds).toEqual([FEED_ID]);

    const feeds = await phone.feeds.getFeeds();
    expect(feeds.map((f) => f.url).sort()).toEqual([FEED_URL, 'https://only.phone/rss']);
    const synced = feeds.find((f) => f.id === FEED_ID)!;
    expect(synced).toMatchObject({ categoryId: tech.id, title: 'Blog', needsPermission: true });
    expect((await phone.categories.getCategories()).map((c) => c.name)).toContain('Tech');
    // Joining adopts the account's settings instead of overwriting them.
    expect((await phone.settings.getSettings()).theme).toBe('dark');

    // The phone-only feed went up and reaches the laptop.
    await laptop.sync();
    expect((await laptop.feeds.getFeeds()).map((f) => f.url)).toContain('https://only.phone/rss');
  });

  it('syncs read and starred, including for articles not fetched yet', async () => {
    const laptop = await device('laptop');
    await laptop.feeds.addFeed({ url: FEED_URL });
    await laptop.articles.upsertArticles(FEED_ID, [item('a'), item('b')]);
    await laptop.signIn();
    await laptop.sync();

    const phone = await device('phone');
    await phone.signIn();
    await phone.sync();

    // Laptop reads "a" and stars "b" before the phone has fetched anything.
    const [a, b] = (await laptop.articles.listArticles({})).items.sort((x, y) =>
      x.title.localeCompare(y.title),
    );
    await laptop.articles.setRead([a!.id], true);
    await laptop.articles.setStarred(b!.id, true);
    await laptop.sync();
    await phone.sync();

    // The phone fetches the feed later; the states are waiting for it.
    await phone.articles.upsertArticles(FEED_ID, [item('a'), item('b')]);
    const onPhone = await phone.articles.listArticles({});
    const byTitle = Object.fromEntries(onPhone.items.map((x) => [x.title, x]));
    expect(byTitle['Item a']).toMatchObject({ read: 1, starred: 0 });
    expect(byTitle['Item b']).toMatchObject({ read: 0, starred: 1 });

    // And back: the phone marks everything read.
    await phone.articles.markAllRead();
    await phone.sync();
    await laptop.sync();
    const onLaptop = await laptop.articles.listArticles({ unreadOnly: true });
    expect(onLaptop.items).toEqual([]);
    expect(await laptop.state.getOutbox()).toEqual({});
  });

  it('later edits win, deletions propagate, and local edits survive an older pull', async () => {
    const laptop = await device('laptop');
    await laptop.feeds.addFeed({ url: FEED_URL });
    await laptop.signIn();
    await laptop.sync();
    const phone = await device('phone');
    await phone.signIn();
    await phone.sync();

    await laptop.feeds.renameFeed(FEED_ID, 'Laptop name');
    await laptop.sync();
    await new Promise((r) => setTimeout(r, 2));
    // The phone renames without having pulled the laptop's change first.
    await phone.feeds.renameFeed(FEED_ID, 'Phone name');
    await phone.sync();
    await laptop.sync();
    expect((await laptop.feeds.getFeed(FEED_ID))?.customTitle).toBe('Phone name');
    expect((await phone.feeds.getFeed(FEED_ID))?.customTitle).toBe('Phone name');

    await phone.feeds.removeFeed(FEED_ID);
    await phone.sync();
    await laptop.sync();
    expect(await laptop.feeds.getFeeds()).toEqual([]);
  });

  it('keeps the PIN and wallpaper off the server', async () => {
    const laptop = await device('laptop');
    await laptop.settings.saveSettings({
      pinHash: 'secret',
      pinSalt: 'salt',
      wallpaper: { id: 'w', dim: 10, blur: 0 },
      autoDiscovery: true,
    });
    await laptop.signIn();
    await laptop.sync();
    const keys = [...server.records.keys()].filter((k) => k.startsWith('setting:'));
    expect(keys.sort()).toEqual(
      ['appearance', 'openMode', 'readingFont', 'refreshIntervalMinutes', 'theme'].map(
        (k) => `setting:${k}`,
      ),
    );
  });
});
