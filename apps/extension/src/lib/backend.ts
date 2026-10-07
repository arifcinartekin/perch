import type { ReaderBackend } from '@perch/reader';
import { sendMessage } from './messaging';
import { hasHostPermission, requestHostPermission } from './permissions/host';
import { extractFullText, getCachedFullText } from './readability/extract';
import {
  getArticle,
  listArticles,
  setRead,
  setStarred,
  unreadCountsByFeed,
} from './storage/articles';
import { addCategory, getCategories, setCollapsed, watchCategories } from './storage/categories';
import {
  changeFeedUrl,
  getFeeds,
  moveFeedToCategory,
  renameFeed,
  watchFeeds,
} from './storage/feeds';
import { watchLocal } from './storage/local';
import { getSettings, saveSettings, watchSettings } from './storage/settings';
import { clearWallpaper, loadWallpaper, saveWallpaper } from './storage/wallpaper';
import { SYNC_KEYS } from './sync/state';

// The reader's data layer in the extension: browser storage, IndexedDB, and
// the background worker for fetching. Site access is asked for per origin,
// always before any other await so the click's user gesture is still valid.

type Cursor = { publishedAt: number; id: string };

export const localBackend: ReaderBackend = {
  loadLibrary: async () => ({ feeds: await getFeeds(), categories: await getCategories() }),
  unreadCounts: unreadCountsByFeed,

  async listArticles(q) {
    const page = await listArticles({
      feedIds: q.scope.kind === 'starred' ? undefined : q.feedIds,
      starredOnly: q.scope.kind === 'starred',
      unreadOnly: q.unreadOnly,
      text: q.text,
      limit: q.limit,
      before: q.cursor ? (JSON.parse(q.cursor) as Cursor) : undefined,
    });
    return { items: page.items, next: page.nextCursor ? JSON.stringify(page.nextCursor) : null };
  },
  getArticle: (ref) => getArticle(ref.id),
  setRead: (refs, read) =>
    setRead(
      refs.map((r) => r.id),
      read,
    ),
  setStarred: (ref, starred) => setStarred(ref.id, starred),
  refresh: (feedIds) => sendMessage('feeds:refresh', { feedIds }),

  async addFeed(url, category) {
    const granted = await requestHostPermission(url);
    const categoryId =
      'newCategory' in category
        ? (await addCategory(category.newCategory)).id
        : category.categoryId;
    const { created } = await sendMessage('feed:add', {
      url,
      categoryId,
      needsPermission: !granted,
    });
    return {
      created,
      message: !created
        ? 'That feed is already in your reader'
        : granted
          ? 'Feed added'
          : 'Feed added — grant site access to fetch it',
    };
  },

  async updateFeed(feed, patch) {
    let urlSwapped = false;
    if (patch.url) {
      await requestHostPermission(patch.url);
      urlSwapped = await changeFeedUrl(feed.id, patch.url);
      if (!urlSwapped) return 'That URL is already used by another feed.';
    }
    if (patch.customTitle !== undefined) await renameFeed(feed.id, patch.customTitle);
    if (patch.category) {
      const target =
        'newCategory' in patch.category
          ? (await addCategory(patch.category.newCategory)).id
          : patch.category.categoryId;
      if (target !== feed.categoryId) await moveFeedToCategory(feed.id, target);
    }
    if (urlSwapped) await sendMessage('feeds:refresh', { feedIds: [feed.id] });
    return null;
  },

  removeFeed: async (feedId) => {
    await sendMessage('feed:remove', { feedId });
  },
  addCategory,
  setCategoryCollapsed: setCollapsed,

  getSettings,
  saveSettings,

  fullText: {
    cached: (article) => getCachedFullText(article.id),
    canExtract: (article) =>
      article.url ? hasHostPermission(article.url) : Promise.resolve(false),
    async extract(article, opts) {
      const result = await extractFullText(article, {
        allowPermissionPrompt: opts.prompt ?? false,
        force: opts.force,
      });
      return result.ok ? { ok: true, fullText: result.fullText } : result;
    },
    requestAccess: (article) =>
      article.url ? requestHostPermission(article.url) : Promise.resolve(false),
  },

  watch({ library, articles, settings }) {
    const stops: (() => void)[] = [];
    if (library) stops.push(watchFeeds(library), watchCategories(library));
    if (articles) {
      // A background refresh finished, or a sync round applied read state.
      stops.push(watchLocal('perch:lastRefresh', articles), watchLocal(SYNC_KEYS.status, articles));
    }
    if (settings) stops.push(watchSettings(settings));
    return () => stops.forEach((stop) => stop());
  },

  async grantFeedAccess(feed) {
    const granted = await requestHostPermission(feed.url);
    if (granted) await sendMessage('feeds:refresh', { feedIds: [feed.id] });
    return granted;
  },

  wallpaper: { load: loadWallpaper, save: saveWallpaper, clear: clearWallpaper },
  features: { refreshInterval: true, openMode: true },
  copy: {
    onboarding:
      'A calm, private reader for RSS, Atom, and JSON feeds. Add your first feed to get started — paste a URL here, or click the Perch icon on any site to discover its feeds.',
    onboardingNote:
      'Perch only requests access to sites you actually add. Automatic discovery on every page is opt-in from Settings.',
    addFeedNote:
      'Perch will ask for permission to fetch this one site. It never requests access to sites you haven’t added.',
    settingsIntro:
      'Everything is stored in your browser. Nothing leaves it unless you turn on sync.',
  },
};
