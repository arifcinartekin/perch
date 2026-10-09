import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX, type ServerInfo } from '@perch/core/api';
import type { Config } from './config';
import { openDatabase, type DB } from './db';
import { meta, users } from './db/schema';
import { FeedWorker } from './feeds/worker';
import { HttpError, errorResponse, type AppContext, type Env } from './http';
import { randomToken } from './lib/crypto';
import { Notifier } from './lib/notifier';
import { createSafeFetch } from './lib/safe-fetch';
import { adminRoutes, authRoutes, deviceRoutes } from './auth/routes';
import { readerRoutes } from './reader/routes';
import { SyncService } from './sync/service';
import { syncRoutes } from './sync/routes';
import { chainRoutes } from './chain/routes';

export const VERSION = '0.1.0';

function instanceSecret(db: DB): string {
  const row = db.select().from(meta).where(eq(meta.key, 'secret')).get();
  if (row) return row.value;
  const value = randomToken(32);
  db.insert(meta).values({ key: 'secret', value }).onConflictDoNothing().run();
  return db.select().from(meta).where(eq(meta.key, 'secret')).get()!.value;
}

export function createContext(config: Config): AppContext & { close: () => void } {
  const { db, close } = openDatabase(config.databasePath);
  const fetch = createSafeFetch({
    allowPrivate: config.fetchAllowPrivate,
    allowHosts: config.fetchAllowHosts,
  });
  const notifier = new Notifier();
  const worker = new FeedWorker(db, fetch, config.fetchIntervalMin, notifier);
  return {
    config,
    db,
    secret: instanceSecret(db),
    fetch,
    worker,
    // Feeds a client subscribes to are fetched right away, not at the next tick.
    sync: new SyncService(db, notifier, (ids) => void worker.refresh(ids)),
    notifier,
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
    });
  });
  api.route('/auth', authRoutes(ctx));
  api.route('/devices', deviceRoutes(ctx));
  api.route('/admin', adminRoutes(ctx));
  api.route('/reader', readerRoutes(ctx));
  api.route('/sync', syncRoutes(ctx));
  api.route('/chain', chainRoutes(ctx));

  app.route(API_PREFIX, api);
  app.get('/healthz', (c) => c.text('ok'));
  return app;
}
