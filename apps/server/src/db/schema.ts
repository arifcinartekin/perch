import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { Enclosure, Settings } from '@perch/core/types';
import type { KdfParams } from '@perch/core/auth';

// SQLite schema. Times are epoch milliseconds. After changing this file run
// `npm run db:generate -w @perch/server` and commit the new migration.

const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** Server-wide key/value: the instance secret, schema flags. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// Accounts (both modes)
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Normalised (see @perch/core/username), unique. */
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** scrypt of the client's Argon2id-derived auth key. */
  authHash: text('auth_hash').notNull(),
  kdfSalt: text('kdf_salt').notNull(),
  kdfParams: text('kdf_params', { mode: 'json' }).$type<KdfParams>().notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  email: text('email'),
  createdAt: integer('created_at').notNull().default(now),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** Public id, used to list and revoke devices. */
    id: text('id').primaryKey(),
    /** SHA-256 of the bearer token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceName: text('device_name').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const invites = sqliteTable('invites', {
  code: text('code').primaryKey(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(now),
  usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: integer('used_at'),
});

// ---------------------------------------------------------------------------
// Personal mode: the server fetches feeds and stores articles
// ---------------------------------------------------------------------------

/** One row per feed URL, shared by every subscriber, fetched once. */
export const feeds = sqliteTable(
  'feeds',
  {
    /** feedIdFor(url) — the same id every client computes. */
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    siteUrl: text('site_url'),
    iconUrl: text('icon_url'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    lastFetchedAt: integer('last_fetched_at'),
    lastError: text('last_error'),
    /** Consecutive failures; drives the back-off. */
    errorCount: integer('error_count').notNull().default(0),
    nextFetchAt: integer('next_fetch_at').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('feeds_next_fetch').on(t.nextFetchAt)],
);

export const categories = sqliteTable(
  'categories',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Client-generated, unique per user (clients create categories offline). */
    id: text('id').notNull(),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feedId: text('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull().default('uncategorized'),
    customTitle: text('custom_title'),
    addedAt: integer('added_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.feedId] }), index('subscriptions_feed').on(t.feedId)],
);

export const articles = sqliteTable(
  'articles',
  {
    feedId: text('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    /** Core article id; unique within its feed (the key is the pair). */
    id: text('id').notNull(),
    guid: text('guid'),
    url: text('url'),
    title: text('title').notNull(),
    author: text('author'),
    publishedAt: integer('published_at').notNull(),
    updatedAt: integer('updated_at'),
    summaryHtml: text('summary_html'),
    contentHtml: text('content_html'),
    enclosures: text('enclosures', { mode: 'json' }).$type<Enclosure[]>().notNull().default([]),
    fetchedAt: integer('fetched_at').notNull(),
    /** foldText() of title, author and body — what search runs against. */
    searchText: text('search_text').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.feedId, t.id] }),
    index('articles_feed_published').on(t.feedId, t.publishedAt),
    index('articles_published').on(t.publishedAt),
  ],
);

/** Read / starred per user. No row = unread and not starred. */
export const articleStates = sqliteTable(
  'article_states',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feedId: text('feed_id').notNull(),
    articleId: text('article_id').notNull(),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.feedId, t.articleId] }),
    index('article_states_starred').on(t.userId, t.starred),
    uniqueIndex('article_states_lookup').on(t.feedId, t.articleId, t.userId),
  ],
);

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).$type<Partial<Settings>>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});
