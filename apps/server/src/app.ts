import { count, eq, like, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX, type ServerInfo } from '@perch/core/api';
import type { Config } from './config';
import { openDatabase, type DB } from './db';
import { emailCodes, meta, users } from './db/schema';
import { FeedWorker } from './feeds/worker';
import { HttpError, errorResponse, type AppContext, type Env } from './http';
import { hmac, randomToken } from './lib/crypto';
import { createMailer, type Mailer } from './lib/mailer';
import { Notifier } from './lib/notifier';
import { createSafeFetch } from './lib/safe-fetch';
import { adminRoutes, authRoutes, deviceRoutes } from './auth/routes';
import { emailIdSync } from './auth/email';
import { readerRoutes } from './reader/routes';
import { SyncService } from './sync/service';
import { syncRoutes } from './sync/routes';
import { chainRoutes } from './chain/routes';
import { noteRoutes, reportRoutes, shareRoutes, sharedPages } from './notes/routes';

export const VERSION = '0.1.0';

function instanceSecret(db: DB): string {
  const row = db.select().from(meta).where(eq(meta.key, 'secret')).get();
  if (row) return row.value;
  const value = randomToken(32);
  db.insert(meta).values({ key: 'secret', value }).onConflictDoNothing().run();
  return db.select().from(meta).where(eq(meta.key, 'secret')).get()!.value;
}

/**
 * Servers from before emailId kept addresses as they were. Replace each with
 * its emailId, drop pending codes, and rewrite the file so the old text isn't
 * left in free pages. Runs once; afterwards no row contains an '@'.
 */
function forgetStoredAddresses(db: DB, key: string) {
  const old = db
    .select({ id: users.id, email: users.emailId })
    .from(users)
    .where(like(users.emailId, '%@%'))
    .all();
  const codes = db
    .select({ n: count() })
    .from(emailCodes)
    .where(like(emailCodes.emailId, '%@%'))
    .get()!.n;
  if (!old.length && !codes) return;
  db.transaction((tx) => {
    for (const u of old) {
      tx.update(users)
        .set({ emailId: emailIdSync(key, u.email!) })
        .where(eq(users.id, u.id))
        .run();
    }
    tx.delete(emailCodes).run();
  });
  db.run(sql`VACUUM`);
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}

export function createContext(
  config: Config,
  deps: { mailer?: Mailer } = {},
): AppContext & { close: () => void } {
  const { db, close } = openDatabase(config.databasePath);
  const fetch = createSafeFetch({
    allowPrivate: config.fetchAllowPrivate,
    allowHosts: config.fetchAllowHosts,
  });
  const secret = instanceSecret(db);
  const emailKey = config.emailKey ?? hmac(secret, 'email-id').toString('base64url');
  forgetStoredAddresses(db, emailKey);
  const notifier = new Notifier();
  const worker = new FeedWorker(db, fetch, config.fetchIntervalMin, notifier);
  return {
    config,
    db,
    secret,
    emailKey,
    fetch,
    worker,
    // Feeds a client subscribes to are fetched right away, not at the next tick.
    sync: new SyncService(db, notifier, (ids) => void worker.refresh(ids)),
    notifier,
    mailer: deps.mailer ?? createMailer(config.email),
    close,
  };
}

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use(secureHeaders());
  app.onError((err, c) => errorResponse(c, err));
  app.notFound((c) => errorResponse(c, new HttpError(404, 'not-found', 'Not found')));

  const api = new Hono<Env>();
  api.get('/server', (c) => {
    const users_ = ctx.db.select({ n: count() }).from(users).get()!.n;
    return c.json<ServerInfo>({
      software: 'perch-server',
      version: VERSION,
      mode: ctx.config.mode,
      signup: ctx.config.signup,
      community: ctx.config.community,
      chain: ctx.config.chain,
      needsSetup: users_ === 0,
      email: ctx.mailer != null,
      ...((ctx.config.privacyUrl || ctx.config.termsUrl) && {
        legal: { privacy: ctx.config.privacyUrl, terms: ctx.config.termsUrl },
      }),
    });
  });
  api.route('/auth', authRoutes(ctx));
  api.route('/devices', deviceRoutes(ctx));
  api.route('/admin', adminRoutes(ctx));
  api.route('/reader', readerRoutes(ctx));
  api.route('/sync', syncRoutes(ctx));
  api.route('/chain', chainRoutes(ctx));
  api.route('/notes', noteRoutes(ctx));
  api.route('/shares', shareRoutes(ctx));
  api.route('/admin/reports', reportRoutes(ctx));

  app.route(API_PREFIX, api);
  app.route('/shared', sharedPages(ctx));
  app.get('/healthz', (c) => c.text('ok'));
  return app;
}
