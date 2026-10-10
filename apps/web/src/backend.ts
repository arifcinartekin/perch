import type {
  AddFeedResponse,
  ArticlesResponse,
  CountsResponse,
  LibraryResponse,
  NotesResponse,
  ShareResponse,
} from '@perch/core/api';
import type { Note } from '@perch/core/notes';
import { stateRecordId } from '@perch/core/sync';
import { isSyncedSettingKey } from '@perch/core/sync';
import {
  DEFAULT_SETTINGS,
  type Article,
  type Category,
  type FullText,
  type Settings,
} from '@perch/core/types';
import { sanitizeHtml, type ReaderBackend } from '@perch/reader';
import { API_PREFIX } from '@perch/core/api';
import { ServerError, api } from './api';

// The reader's data layer on the web: the Perch Server's reader API. The
// server fetches feeds and full text; changes from other devices arrive over
// Server-Sent Events.

const STATE_BATCH = 1000;

type Handlers = Parameters<ReaderBackend['watch']>[0];

export function createServerBackend(): ReaderBackend & { close(): void } {
  let settings: Settings | null = null;
  const watchers = new Set<Handlers>();
  let events: EventSource | null = null;

  const loadSettings = async () => {
    const { settings: stored } = await api<{ settings: Partial<Settings> }>('/reader/settings');
    settings = { ...DEFAULT_SETTINGS, ...stored };
    return settings;
  };

  const each = (fn: (h: Handlers) => void) => watchers.forEach(fn);
  /** Our own changes show at once rather than waiting for the event stream. */
  const libraryChanged = () => each((h) => h.library?.());

  // One stream for the page, opened on first use. EventSource reconnects by itself.
  const openEvents = () => {
    if (events) return;
    let lastCursor: string | null = null;
    events = new EventSource(`${API_PREFIX}/sync/events`);
    events.addEventListener('cursor', (e) => {
      const cursor = (e as MessageEvent<string>).data;
      // The first event only reports where we are. Later ones mean the library,
      // read state or settings changed (here or elsewhere): refresh the sidebar,
      // counts and settings. The open article list is left alone — reloading it
      // on every read-mark would throw away the scroll position.
      if (lastCursor !== null && cursor !== lastCursor) {
        libraryChanged();
        each((h) => h.notes?.());
        void loadSettings().then((s) => each((h) => h.settings?.(s)));
      }
      lastCursor = cursor;
    });
    events.addEventListener('articles', () => each((h) => h.articles?.()));
  };

  const cleanSettings = (patch: Partial<Settings>) =>
    Object.fromEntries(Object.entries(patch).filter(([k]) => isSyncedSettingKey(k)));

  const addCategory = async (name: string) => {
    const { category } = await api<{ category: Category }>('/reader/categories', {
      body: { name },
    });
    libraryChanged();
    return category;
  };

  const subscribe = async (url: string, categoryId: string, title?: string) =>
    api<AddFeedResponse>('/reader/feeds', { body: { url, categoryId, title } });

  return {
    loadLibrary: () => api<LibraryResponse>('/reader/library'),
    unreadCounts: async () => (await api<CountsResponse>('/reader/counts')).unread,

    async listArticles(q) {
      const params = new URLSearchParams({ limit: String(q.limit) });
      if (q.scope.kind === 'starred') params.set('starred', '1');
      if (q.scope.kind === 'feed') params.set('feed', q.scope.id);
      if (q.scope.kind === 'category') params.set('category', q.scope.id);
      if (q.unreadOnly) params.set('unread', '1');
      if (q.text) params.set('q', q.text);
      if (q.cursor) params.set('before', q.cursor);
      const page = await api<ArticlesResponse>(`/reader/articles?${params}`);
      return { items: page.items, next: page.next };
    },
    async getArticle(ref) {
      try {
        return (await api<{ article: Article }>(`/reader/articles/${ref.feedId}/${ref.id}`))
          .article;
      } catch (err) {
        if (err instanceof ServerError && err.status === 404) return undefined;
        throw err;
      }
    },
    async setRead(refs, read) {
      for (let i = 0; i < refs.length; i += STATE_BATCH) {
        const items = refs.slice(i, i + STATE_BATCH).map(({ feedId, id }) => ({ feedId, id }));
        await api('/reader/articles/state', { body: { items, read } });
      }
    },
    async setStarred(ref, starred) {
      await api('/reader/articles/state', {
        body: { items: [{ feedId: ref.feedId, id: ref.id }], starred },
      });
    },
    refresh: (feedIds) => api('/reader/refresh', { body: feedIds ? { feeds: feedIds } : {} }),

    async addFeed(url, category) {
      const categoryId =
        'newCategory' in category
          ? (await addCategory(category.newCategory)).id
          : category.categoryId;
      const { created } = await subscribe(url, categoryId);
      libraryChanged();
      // The server fetched it while subscribing; show its articles.
      each((h) => h.articles?.());
      return { created, message: created ? 'Feed added' : 'That feed is already in your reader' };
    },

    async updateFeed(feed, patch) {
      const categoryId = patch.category
        ? 'newCategory' in patch.category
          ? (await addCategory(patch.category.newCategory)).id
          : patch.category.categoryId
        : feed.categoryId;
      if (patch.url) {
        // A feed is its URL on the server: subscribe to the new one, drop the old.
        try {
          const { feed: next } = await subscribe(patch.url, categoryId);
          const title = patch.customTitle ?? feed.customTitle;
          if (title)
            await api(`/reader/feeds/${next.id}`, {
              method: 'PATCH',
              body: { customTitle: title },
            });
          await api(`/reader/feeds/${feed.id}`, { method: 'DELETE' });
          libraryChanged();
          return null;
        } catch (err) {
          return (err as Error).message;
        }
      }
      await api(`/reader/feeds/${feed.id}`, {
        method: 'PATCH',
        body: {
          ...(patch.customTitle !== undefined && { customTitle: patch.customTitle || null }),
          ...(categoryId !== feed.categoryId && { categoryId }),
        },
      });
      libraryChanged();
      return null;
    },

    removeFeed: async (feedId) => {
      await api(`/reader/feeds/${feedId}`, { method: 'DELETE' });
      libraryChanged();
    },
    addCategory,
    setCategoryCollapsed: async (id, collapsed) => {
      await api(`/reader/categories/${id}`, { method: 'PATCH', body: { collapsed } });
    },

    getSettings: async () => settings ?? loadSettings(),
    async saveSettings(patch) {
      const body = cleanSettings(patch);
      // Show the change at once; the server keeps the account copy.
      settings = { ...(settings ?? (await loadSettings())), ...patch };
      if (Object.keys(body).length) {
        const { settings: stored } = await api<{ settings: Partial<Settings> }>(
          '/reader/settings',
          { method: 'PUT', body },
        );
        settings = { ...DEFAULT_SETTINGS, ...stored };
      }
      return settings;
    },

    fullText: {
      // The server caches extractions itself.
      cached: async () => undefined,
      canExtract: async (article) => Boolean(article.url),
      async extract(article, opts) {
        try {
          const { fullText } = await api<{ fullText: FullText }>(
            `/reader/articles/${article.feedId}/${article.id}/fulltext${opts.force ? '?force=1' : ''}`,
          );
          return {
            ok: true,
            fullText: { ...fullText, html: sanitizeHtml(fullText.html, { baseUrl: article.url }) },
          };
        } catch (err) {
          const e = err as ServerError;
          return {
            ok: false,
            reason: e.code === 'extract-failed' ? 'extract-failed' : 'fetch-failed',
            detail: e.message,
          };
        }
      },
      requestAccess: async () => true,
    },

    notes: {
      list: async () => (await api<NotesResponse>('/notes')).notes,
      save: async (source, body) => {
        const id = stateRecordId(source.feedId, source.articleId);
        const { note } = await api<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: { title: source.title, url: source.url, feedTitle: source.feedTitle, body },
        });
        return note;
      },
      remove: async (id) => {
        await api(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    },

    sharing: {
      unavailable: async () => null,
      share: async (id) =>
        (await api<ShareResponse>(`/shares/${encodeURIComponent(id)}`, { method: 'PUT', body: {} }))
          .url,
      unshare: async (id) => {
        await api(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    },

    watch(handlers) {
      watchers.add(handlers);
      openEvents();
      // The stream stays open for the page's lifetime; components come and go.
      return () => watchers.delete(handlers);
    },

    /** Stop listening (signing out). */
    close() {
      events?.close();
      events = null;
      watchers.clear();
    },

    features: { refreshInterval: false, openMode: false },
    copy: {
      onboarding:
        'A calm reader for RSS, Atom, and JSON feeds. Add your first feed to get started — paste a feed URL or just a site’s address and Perch will find its feed.',
      onboardingNote:
        'Your server fetches feeds for you, so they’re up to date on every device — including this browser and the Perch extension.',
      addFeedNote:
        'Paste a feed URL or a site’s address. Your server fetches it, and your other devices pick it up.',
      settingsIntro: 'These follow your account to every device signed in to this server.',
    },
  };
}
