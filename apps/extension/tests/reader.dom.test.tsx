// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';

// In-memory `browser` stub, built inside vi.hoisted so vi.mock can reference it.
const mocks = vi.hoisted(() => {
  const local = new Map<string, unknown>();
  const changeListeners = new Set<(...a: unknown[]) => void>();
  const origins = new Set<string>();
  const noop = { addListener: () => {}, removeListener: () => {}, hasListener: () => false };

  const browser = {
    runtime: {
      getURL: (p: string) => `chrome-extension://perch${p}`,
      sendMessage: vi.fn(async () => null),
      onMessage: noop,
      id: 'perch',
    },
    storage: {
      local: {
        get: async (key?: string | string[] | null) => {
          if (key == null) return Object.fromEntries(local);
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => local.has(k)).map((k) => [k, local.get(k)]));
        },
        set: async (items: Record<string, unknown>) => {
          const changes: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: local.get(k), newValue: v };
            local.set(k, v);
          }
          changeListeners.forEach((l) => l(changes, 'local'));
        },
        remove: async (k: string) => void local.delete(k),
      },
      onChanged: {
        addListener: (l: (...a: unknown[]) => void) => changeListeners.add(l),
        removeListener: (l: (...a: unknown[]) => void) => changeListeners.delete(l),
      },
    },
    permissions: {
      contains: async ({ origins: o = [] }: { origins?: string[] }) =>
        o.every((x) => origins.has(x)),
      request: async ({ origins: o = [] }: { origins?: string[] }) => {
        o.forEach((x) => origins.add(x));
        return true;
      },
      remove: async ({ origins: o = [] }: { origins?: string[] }) => {
        o.forEach((x) => origins.delete(x));
        return true;
      },
      onAdded: noop,
      onRemoved: noop,
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: 'https://example.com/' }]),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      get: vi.fn(async () => ({ id: 1, url: 'https://example.com/' })),
      onUpdated: noop,
      onRemoved: noop,
    },
    windows: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      getAll: vi.fn(async () => []),
      getCurrent: vi.fn(async () => ({ width: 1440, height: 900, left: 0, top: 0 })),
    },
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeTextColor: vi.fn(async () => {}),
    },
    alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: noop },
  };
  return { browser, local };
});

vi.mock('wxt/browser', () => ({ browser: mocks.browser }));

const { __resetDbForTests } = await import('@/lib/storage/db');
const { upsertArticles } = await import('@/lib/storage/articles');
const { App } = await import('@/entrypoints/reader/App');
const { App: PopupApp } = await import('@/entrypoints/popup/App');

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetDbForTests();
  mocks.local.clear();
});
afterEach(() => cleanup());

describe('reader app', () => {
  it('shows onboarding when there are no feeds', async () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    expect(await screen.findByText('Welcome to Perch')).toBeTruthy();
  });

  it('renders the stream once a feed and articles exist', async () => {
    await mocks.browser.storage.local.set({
      'perch:feeds': [
        {
          id: 'feed-a',
          url: 'https://example.com/feed',
          title: 'Example',
          categoryId: 'uncategorized',
          addedAt: Date.now(),
        },
      ],
      'perch:categories': [{ id: 'uncategorized', name: 'Uncategorized', order: 1000 }],
    });
    await upsertArticles('feed-a', [
      {
        title: 'A headline',
        url: 'https://example.com/1',
        guid: 'g1',
        publishedAt: Date.now(),
        enclosures: [],
        summaryHtml: '<p>Body</p>',
      },
    ]);

    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText('All Feeds')).toBeTruthy());
    expect(await screen.findByText('A headline')).toBeTruthy();
  });
});

describe('popup app', () => {
  it('mounts and offers to open the reader', async () => {
    render(<PopupApp />);
    expect(await screen.findByText('Open RSS Reader')).toBeTruthy();
  });
});
