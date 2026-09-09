// Shared domain types for Perch. Kept dependency-free so it can be imported from
// the background service worker, the popup, the reader page, and unit tests.

export type FeedFormat = 'rss' | 'atom' | 'json';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ReaderOpenMode = 'tab' | 'window';

/** User-configurable settings, persisted in `browser.storage.local`. */
export interface Settings {
  /** Open the reader in a new tab or a detached app-style window. */
  openMode: ReaderOpenMode;
  /** Background refresh interval in minutes. Clamped to >= MIN_REFRESH_MINUTES. */
  refreshIntervalMinutes: number;
  /** Light / dark / follow the OS. */
  theme: ThemePreference;
  /**
   * When true, Perch has been granted the optional all-sites host permission and
   * proactively scans pages for feeds as you browse (drives the toolbar badge).
   * When false, discovery only runs on the active tab when the popup is opened.
   */
  autoDiscovery: boolean;
  /** Reading typeface in the article pane. */
  readingFont: 'sans' | 'serif';
  /**
   * Optional 6-digit PIN gate for the reader. This is a convenience lock, NOT
   * real security — the data is still in local storage in the clear. We store a
   * salted SHA-256 of the PIN so the PIN itself isn't sitting in settings.
   */
  pinSalt?: string;
  pinHash?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  openMode: 'tab',
  refreshIntervalMinutes: 30,
  theme: 'system',
  autoDiscovery: false,
  readingFont: 'sans',
};

export const MIN_REFRESH_MINUTES = 15;

/** A subscribed feed. Stored in `browser.storage.local` (small, rarely changes). */
export interface Feed {
  /** Stable id (hash of the normalised feed URL). */
  id: string;
  /** Canonical feed URL that Perch fetches. */
  url: string;
  /** Title from the feed document. */
  title: string;
  /** User override for the display title, if any. */
  customTitle?: string;
  /** Human-facing website the feed belongs to (used for favicons / "open site"). */
  siteUrl?: string;
  /** Icon URL advertised by the feed, if any. */
  iconUrl?: string;
  /** Category this feed belongs to. */
  categoryId: string;
  addedAt: number;
  lastFetchedAt?: number;
  /** Last refresh error message, cleared on a successful refresh. */
  lastError?: string;
  /** True when the host permission needed to fetch this feed has not been granted. */
  needsPermission?: boolean;
  /** Conditional-GET validators from the previous successful fetch. */
  etag?: string;
  lastModified?: string;
}

/** A user-defined grouping of feeds. */
export interface Category {
  id: string;
  name: string;
  /** Sort order in the sidebar. */
  order: number;
  /** Whether the group is collapsed in the sidebar. */
  collapsed?: boolean;
}

export const UNCATEGORIZED_ID = 'uncategorized';

export interface Enclosure {
  url: string;
  type?: string;
  length?: number;
}

/** A normalised article, persisted in IndexedDB. */
export interface Article {
  /** Stable id: hash(feedId + (guid || url || title+publishedAt)). */
  id: string;
  feedId: string;
  /** Raw guid/id from the feed, if present. */
  guid?: string;
  /** Canonical link to the original item. */
  url?: string;
  title: string;
  author?: string;
  /** Publication time (epoch ms). Falls back through updated/now when absent. */
  publishedAt: number;
  updatedAt?: number;
  /** Short summary / excerpt HTML from the feed (unsanitised; sanitise on render). */
  summaryHtml?: string;
  /** Full content HTML from the feed when it provides it (unsanitised). */
  contentHtml?: string;
  enclosures: Enclosure[];
  /** 0 = unread, 1 = read. Numeric so it can be an IndexedDB index key. */
  read: 0 | 1;
  /** 0 = not starred, 1 = starred. */
  starred: 0 | 1;
  /** When Perch first stored this item. */
  fetchedAt: number;
}

/** Cached Readability extraction for an article, persisted in IndexedDB. */
export interface FullText {
  articleId: string;
  /** Sanitised full-text HTML. */
  html: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  extractedAt: number;
}

/** Result of parsing a feed document, before it is merged into storage. */
export interface ParsedFeed {
  format: FeedFormat;
  title: string;
  siteUrl?: string;
  iconUrl?: string;
  articles: ParsedArticle[];
}

export type ParsedArticle = Omit<Article, 'id' | 'feedId' | 'read' | 'starred' | 'fetchedAt'>;

/** A feed found on a page but not (yet) subscribed to. */
export interface DiscoveredFeed {
  url: string;
  title?: string;
  /** How the feed was found. */
  via: 'link-tag' | 'probe';
  /** True when this URL already matches a subscribed feed. */
  alreadyAdded: boolean;
}

/** Per-tab discovery state, cached by the background worker. */
export interface TabDiscovery {
  tabId: number;
  pageUrl: string;
  pageTitle?: string;
  iconHref?: string;
  feeds: DiscoveredFeed[];
  scannedAt: number;
}
