import type { KdfParams } from './auth';
import type { Article, Category, Feed, Settings } from './types';

// Perch Server HTTP API (/api/v1). Request and response shapes shared by the
// server and every client, so a change to one breaks the other at compile time.

export const API_PREFIX = '/api/v1';

export type ServerMode = 'personal' | 'e2e';
export type SignupPolicy = 'open' | 'invite' | 'closed';

/** GET /server — read first by a client connecting to a server. */
export interface ServerInfo {
  software: 'perch-server';
  version: string;
  mode: ServerMode;
  signup: SignupPolicy;
  community: boolean;
  /** No accounts yet: the first account to register becomes the admin. */
  needsSetup: boolean;
}

export interface ApiError {
  error: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface PreloginRequest {
  username: string;
}
export interface PreloginResponse {
  salt: string;
  kdf: KdfParams;
}

export interface RegisterRequest {
  username: string;
  /** From `deriveKeys(password, salt, kdf)`. */
  authKey: string;
  salt: string;
  kdf: KdfParams;
  invite?: string;
  deviceName?: string;
}

export interface LoginRequest {
  username: string;
  authKey: string;
  deviceName?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export interface AuthResponse {
  /** Session token. Send as `Authorization: Bearer <token>`; web clients also get a cookie. */
  token: string;
  user: PublicUser;
}

export interface ChangePasswordRequest {
  authKey: string;
  newAuthKey: string;
  salt: string;
  kdf: KdfParams;
}

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface Invite {
  code: string;
  createdAt: number;
  usedBy?: string;
  usedAt?: number;
}

// ---------------------------------------------------------------------------
// Reader (personal mode)
// ---------------------------------------------------------------------------

/** A subscription as the server sees it. Same shape the extension stores. */
export type ServerFeed = Omit<Feed, 'needsPermission' | 'etag' | 'lastModified'>;

export interface LibraryResponse {
  feeds: ServerFeed[];
  categories: Category[];
}

export interface CountsResponse {
  unread: Record<string, number>;
  starred: number;
}

export interface AddFeedRequest {
  /** A feed URL, or a page that links to one. */
  url: string;
  categoryId?: string;
  title?: string;
}

export interface UpdateFeedRequest {
  categoryId?: string;
  /** null clears the custom title. */
  customTitle?: string | null;
}

export interface CategoryRequest {
  name?: string;
  order?: number;
  collapsed?: boolean;
}

export interface ArticlesQuery {
  feed?: string;
  category?: string;
  unread?: boolean;
  starred?: boolean;
  q?: string;
  limit?: number;
  /** Opaque cursor from a previous page's `next`. */
  before?: string;
}

export interface ArticlesResponse {
  items: Article[];
  next: string | null;
}

export interface ArticleRef {
  feedId: string;
  id: string;
}

export interface ArticleStateRequest {
  items: ArticleRef[];
  read?: boolean;
  starred?: boolean;
}

export interface MarkAllReadRequest {
  feed?: string;
  category?: string;
  /** Only articles published at or before this time (epoch ms). Defaults to now. */
  upTo?: number;
}

export interface OpmlImportResponse {
  added: number;
  existing: number;
  categories: number;
}

/** Settings that follow the account. The PIN and wallpaper stay on each device. */
export type SyncedSettings = Omit<Settings, 'pinSalt' | 'pinHash' | 'wallpaper'>;
