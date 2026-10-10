import type { KdfParams } from './auth';
import type { Article, Category, Feed, Settings } from './types';

// Perch Server HTTP API (/api/v1). Request and response shapes shared by the
// server and every client, so a change to one breaks the other at compile time.

export const API_PREFIX = '/api/v1';

/**
 * `personal`: the server keeps each account's library and fetches its feeds.
 * `hub`: Perch accounts only (community identity, shared notes); libraries
 * stay on devices and sync through chains. `e2e` is reserved.
 */
export type ServerMode = 'personal' | 'hub' | 'e2e';
/** `email`: anyone may sign up after confirming an email address with a code. */
export type SignupPolicy = 'open' | 'invite' | 'email' | 'closed';

/** GET /server — read first by a client connecting to a server. */
export interface ServerInfo {
  software: 'perch-server';
  version: string;
  mode: ServerMode;
  signup: SignupPolicy;
  community: boolean;
  /** Relays sync chains (sync without an account; see chain.ts). */
  chain?: boolean;
  /** No accounts yet: the first account to register becomes the admin. */
  needsSetup: boolean;
  /** The server can send email: codes for signup, password reset and adding an address. */
  email?: boolean;
  /** The operator's privacy policy and terms, when they've published them. */
  legal?: { privacy?: string; terms?: string };
  /** Signing up needs a proof of work this many bits hard (see pow.ts); absent when not. */
  pow?: number;
  /** Accounts can set a recovery code and reset the password with it. */
  recovery?: boolean;
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
  /** Required when signup is `email`, together with `emailCode`. */
  email?: string;
  emailCode?: string;
  /** Required when the server asks for proof of work (`ServerInfo.pow`). */
  pow?: PowSolution;
  /** A code from newRecoveryCode() (recovery.ts) to reset the password with later. */
  recoveryCode?: string;
  deviceName?: string;
}

/** GET /auth/challenge */
export interface PowChallenge {
  challenge: string;
  bits: number;
}

export interface PowSolution {
  challenge: string;
  nonce: string;
}

/** POST /auth/recover — set a new password with the recovery code. Signs in. */
export interface RecoverRequest {
  username: string;
  recoveryCode: string;
  authKey: string;
  salt: string;
  kdf: KdfParams;
  deviceName?: string;
}

/** POST /auth/recovery — replace the signed-in account's recovery code. */
export interface SetRecoveryRequest {
  authKey: string;
  recoveryCode: string;
}

/** What an emailed code is for. */
export type EmailPurpose = 'signup' | 'reset' | 'change';

/**
 * POST /auth/email/code — email a 6-digit code. Always answers `{ ok: true }`, so it
 * can't be used to learn whether an address has an account. `change` needs a session.
 */
export interface EmailCodeRequest {
  email: string;
  purpose: EmailPurpose;
  /** Language of the email; English when absent or unknown. */
  lang?: string;
}

/** POST /auth/reset — set a new password with an emailed code. Signs out every device. */
export interface ResetPasswordRequest {
  email: string;
  code: string;
  authKey: string;
  salt: string;
  kdf: KdfParams;
  deviceName?: string;
}

/** POST /auth/email — add or change the signed-in account's address. */
export interface ChangeEmailRequest {
  email: string;
  code: string;
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
  /**
   * The account has a confirmed email address (for password reset). The
   * server keeps only a keyed hash of it, so it can't say which address.
   */
  hasEmail?: boolean;
  /** A recovery code is set. */
  hasRecovery?: boolean;
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

/** Deletes the account and everything stored with it. The password confirms it. */
export interface DeleteAccountRequest {
  authKey: string;
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

export interface AddFeedResponse {
  feed: ServerFeed;
  /** False when you were already subscribed. */
  created: boolean;
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

// ---------------------------------------------------------------------------
// Notes and sharing
// ---------------------------------------------------------------------------

/** GET /notes */
export interface NotesResponse {
  notes: import('./notes').Note[];
}

/** PUT /notes/:id (id = feedId:articleId). The server keeps the times and the share link. */
export interface SaveNoteRequest {
  title: string;
  url?: string;
  feedTitle?: string;
  body: string;
}

/**
 * PUT /shares/:noteId publishes the note; DELETE takes it down. The body
 * carries the note (SaveNoteRequest); on a personal server it may be left out
 * to publish the copy the server already has.
 */
export interface ShareResponse {
  url: string;
  slug: string;
}

/** GET /shares: the account's public pages. */
export interface SharedNoteSummary {
  noteId: string;
  slug: string;
  url: string;
  title: string;
  feedTitle?: string;
  updatedAt: number;
  /** Taken down after a report. */
  hidden?: boolean;
}

export type ReportReason = 'illegal' | 'harassment' | 'spam' | 'other';

/** GET /admin/reports */
export interface ReportItem {
  id: string;
  reason: ReportReason;
  details: string;
  contact?: string;
  createdAt: number;
  share: {
    slug: string;
    url: string;
    title: string;
    body: string;
    author: string;
    hidden: boolean;
  };
}
