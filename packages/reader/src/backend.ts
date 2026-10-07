import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { Article, Category, Feed, FullText, Settings } from '@perch/core/types';

// Everything the reader UI needs from where the data lives. The extension
// implements it over browser storage and IndexedDB; the web reader over the
// Perch Server API. The UI never touches storage directly.

export interface ArticleRef {
  feedId: string;
  id: string;
}

export type StreamScope =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'feed'; id: string }
  | { kind: 'category'; id: string };

export interface ArticleQuery {
  scope: StreamScope;
  /** The scope resolved to feed ids (all of a category's feeds, …); undefined = every feed. */
  feedIds?: string[];
  unreadOnly?: boolean;
  /** Free-text search. */
  text?: string;
  limit: number;
  /** Opaque cursor from the previous page. */
  cursor?: string;
}

export interface ArticlePage {
  items: Article[];
  /** Cursor for the next page, or null at the end. */
  next: string | null;
}

export type FullTextFailure = 'no-url' | 'permission-denied' | 'fetch-failed' | 'extract-failed';

export type FullTextResult =
  { ok: true; fullText: FullText } | { ok: false; reason: FullTextFailure; detail?: string };

export interface AddFeedResult {
  created: boolean;
  /** Shown as a toast. */
  message: string;
}

/** Where a feed goes: an existing category, or a new one created on the way. */
export type CategoryChoice = { categoryId: string } | { newCategory: string };

export interface FeedPatch {
  customTitle?: string;
  category?: CategoryChoice;
  url?: string;
}

export interface ReaderBackend {
  // Library ------------------------------------------------------------------
  loadLibrary(): Promise<{ feeds: Feed[]; categories: Category[] }>;
  unreadCounts(): Promise<Record<string, number>>;

  // Articles -----------------------------------------------------------------
  listArticles(query: ArticleQuery): Promise<ArticlePage>;
  getArticle(ref: ArticleRef): Promise<Article | undefined>;
  setRead(refs: ArticleRef[], read: boolean): Promise<void>;
  setStarred(ref: ArticleRef, starred: boolean): Promise<void>;
  /** Fetch feeds now. Omit ids for all of them. */
  refresh(feedIds?: string[]): Promise<{ refreshed: number; failed: number }>;

  // Feeds and categories ----------------------------------------------------
  /** Call straight from a click: the extension asks for site access before anything else. */
  addFeed(url: string, category: CategoryChoice): Promise<AddFeedResult>;
  /** Call from a click (a new URL may need site access). Returns an error message, or null. */
  updateFeed(feed: Feed, patch: FeedPatch): Promise<string | null>;
  removeFeed(feedId: string): Promise<void>;
  addCategory(name: string): Promise<Category>;
  setCategoryCollapsed(id: string, collapsed: boolean): Promise<void>;

  // Settings -----------------------------------------------------------------
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;

  // Full text ----------------------------------------------------------------
  fullText: {
    cached(article: Article): Promise<FullText | undefined>;
    /** Whether extract() can run without a click (no permission prompt needed). */
    canExtract(article: Article): Promise<boolean>;
    extract(article: Article, opts: { force?: boolean; prompt?: boolean }): Promise<FullTextResult>;
    /** Ask for whatever access extraction needs. Call from a click. */
    requestAccess(article: Article): Promise<boolean>;
  };

  // Change notifications ------------------------------------------------------
  /** Subscribe to changes made elsewhere (another tab, device, the background). */
  watch(handlers: {
    library?: () => void;
    articles?: () => void;
    settings?: (settings: Settings) => void;
  }): () => void;

  // Optional, host-specific -----------------------------------------------
  /** Per-site access (extension): the feed can't be fetched until granted. */
  grantFeedAccess?(feed: Feed): Promise<boolean>;
  /** Background image for the reader, stored on the device. */
  wallpaper?: {
    load(id: string): Promise<Blob | undefined>;
    save(file: File): Promise<string>;
    clear(): Promise<void>;
  };
  features: {
    /** The refresh interval is a setting (on the web the server decides). */
    refreshInterval: boolean;
    /** "Open the reader in a tab or a window" (extension only). */
    openMode: boolean;
  };
  /** Copy that differs by host. */
  copy: {
    onboarding: string;
    onboardingNote: string;
    addFeedNote: string;
    settingsIntro: string;
  };
}

const BackendContext = createContext<ReaderBackend | null>(null);

export function BackendProvider({
  backend,
  children,
}: {
  backend: ReaderBackend;
  children: ReactNode;
}) {
  return createElement(BackendContext.Provider, { value: backend }, children);
}

export function useBackend(): ReaderBackend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend must be used within <BackendProvider>');
  return backend;
}

/** "feedId:articleId", used for the open article in the URL (?a=). */
export const articleParam = (a: ArticleRef) => `${a.feedId}:${a.id}`;

export function parseArticleParam(value: string | null): ArticleRef | null {
  if (!value) return null;
  const i = value.indexOf(':');
  return i > 0 ? { feedId: value.slice(0, i), id: value.slice(i + 1) } : null;
}
