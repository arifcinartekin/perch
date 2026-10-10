import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { feedIdFor } from '@perch/core/feeds';
import type { ParsedArticle } from '@perch/core/types';
import { createApp, createContext } from '../../server/src/app';
import { testConfig } from '../../server/src/config';
import { chainRecords } from '../../server/src/db/schema';

// Two devices in a sync chain, through the real server's relay (in process).
// The engine itself is covered by sync.test.ts; this checks that chains carry
// the same library through encryption, and that the relay learns nothing.

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

const RELAY = 'https://relay.test';
let ctx: ReturnType<typeof createContext>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  ctx = createContext(testConfig({ chain: true }));
  app = createApp(ctx);
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin !== RELAY) throw new Error(`unexpected request to ${input}`);
    return app.request(`${url.pathname}${url.search}`, init);
  }) as typeof fetch;
});
afterEach(() => ctx.close());

async function device() {
  const store = new Map<string, unknown>();
  const idb = new IDBFactory();
  (globalThis as any).__deviceStore = store;
  globalThis.indexedDB = idb;
  vi.resetModules();
  const [engine, state, chain, feeds, categories, settings, articles, db, devices] =
    await Promise.all([
      import('@/lib/sync/engine'),
      import('@/lib/sync/state'),
      import('@/lib/sync/chain'),
      import('@/lib/storage/feeds'),
      import('@/lib/storage/categories'),
      import('@/lib/storage/settings'),
      import('@/lib/storage/articles'),
      import('@/lib/storage/db'),
      import('@/lib/sync/devices'),
    ]);
  await db.getDB();
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
    state: bind(state),
    chain: bind(chain),
    feeds: bind(feeds),
    categories: bind(categories),
    settings: bind(settings),
    articles: bind(articles),
    devices: bind(devices),
    sync: () => {
      activate();
      return engine.syncNow();
    },
  };
}

const FEED_URL = 'https://blog.example/feed.xml';
const FEED_ID = feedIdFor(FEED_URL);
const item = (guid: string): ParsedArticle => ({
  guid,
  title: `Item ${guid}`,
  url: `https://blog.example/${guid}`,
  publishedAt: Date.parse('2026-10-01T00:00:00Z'),
  enclosures: [],
});

describe('sync chains', () => {
  it('carries the library, settings and read state between devices, sealed', async () => {
    const laptop = await device();
    await laptop.feeds.addFeed({ url: FEED_URL, title: 'Blog' });
    const tech = await laptop.categories.addCategory('Tech');
    await laptop.feeds.moveFeedToCategory(FEED_ID, tech.id);
    await laptop.settings.saveSettings({ theme: 'dark' });
    await laptop.articles.upsertArticles(FEED_ID, [item('a'), item('b')]);
    const account = await laptop.chain.createChain(RELAY);
    expect(account.code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
    await laptop.state.saveAccount(account);
    expect((await laptop.sync())?.pushed).toBeGreaterThan(0);

    // The relay holds only opaque slots and ciphertext.
    const rows = ctx.db.select().from(chainRecords).all();
    expect(rows.length).toBeGreaterThan(5);
    const dump = JSON.stringify(rows);
    for (const secret of ['blog.example', FEED_ID, 'Tech', 'dark', 'feed:', 'setting:']) {
      expect(dump).not.toContain(secret);
    }

    const phone = await device();
    await phone.state.saveAccount(await phone.chain.joinChain(RELAY, account.code.toLowerCase()));
    const res = await phone.sync();
    expect(res?.newFeedIds).toEqual([FEED_ID]);
    const feed = (await phone.feeds.getFeeds())[0]!;
    expect(feed).toMatchObject({ url: FEED_URL, title: 'Blog', categoryId: tech.id });
    expect((await phone.categories.getCategories()).map((c) => c.name)).toContain('Tech');
    expect((await phone.settings.getSettings()).theme).toBe('dark');

    // Each device lists itself in the chain; the relay can't read the names.
    await laptop.sync();
    const listed = await laptop.devices.getDevices();
    expect(Object.keys(listed).sort()).toEqual(
      [account.node, (await phone.state.getAccount())!.node].sort(),
    );
    expect(JSON.stringify(ctx.db.select().from(chainRecords).all())).not.toContain('Chrome');

    // Read on the laptop, starred on the phone: both arrive on both.
    const [a, b] = (await laptop.articles.listArticles({})).items.sort((x, y) =>
      x.title.localeCompare(y.title),
    );
    await laptop.articles.setRead([a!.id], true);
    await laptop.sync();
    await phone.articles.upsertArticles(FEED_ID, [item('a'), item('b')]);
    await phone.sync();
    await phone.articles.setStarred(b!.id, true);
    await phone.sync();
    await laptop.sync();
    const titles = async (d: Awaited<ReturnType<typeof device>>) =>
      Object.fromEntries(
        (await d.articles.listArticles({})).items.map((x) => [x.title, [x.read, x.starred]]),
      );
    expect(await titles(laptop)).toEqual({ 'Item a': [1, 0], 'Item b': [0, 1] });
    expect(await titles(phone)).toEqual({ 'Item a': [1, 0], 'Item b': [0, 1] });

    // Removing the feed on the phone removes it on the laptop.
    await phone.feeds.removeFeed(FEED_ID);
    await phone.sync();
    await laptop.sync();
    expect(await laptop.feeds.getFeeds()).toEqual([]);
  });

  it('refuses a code nobody started', async () => {
    const phone = await device();
    const laptop = await device();
    const account = await laptop.chain.createChain(RELAY);
    // A valid code for a chain that doesn't exist.
    const { formatChainCode, newChainSecret } = await import('@perch/core/chain');
    await expect(phone.chain.joinChain(RELAY, formatChainCode(newChainSecret()))).rejects.toThrow(
      'No chain with this code',
    );
    await expect(phone.chain.joinChain(RELAY, account.code)).resolves.toMatchObject({
      kind: 'chain',
    });
  });

  it('stops syncing everywhere when one device deletes the chain', async () => {
    const laptop = await device();
    const account = await laptop.chain.createChain(RELAY);
    await laptop.state.saveAccount(account);
    await laptop.feeds.addFeed({ url: FEED_URL });
    await laptop.sync();

    const phone = await device();
    await phone.state.saveAccount(await phone.chain.joinChain(RELAY, account.code));
    await phone.sync();

    await laptop.chain.deleteChain(account);
    await expect(phone.sync()).rejects.toThrow();
    const status = await phone.state.getStatus();
    expect(status).toMatchObject({
      signedOut: true,
      lastError: 'This chain was deleted on another device.',
    });
    // The phone keeps its library.
    expect((await phone.feeds.getFeeds()).map((f) => f.url)).toEqual([FEED_URL]);
  });
});
