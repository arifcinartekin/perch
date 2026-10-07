import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { SYNC_PAGE_MAX, SYNC_PUSH_MAX, type SyncRecord } from '@perch/core/sync';
import { requireUser } from '../auth/sessions';
import { badRequest, jsonBody, type AppContext, type Env } from '../http';

export function syncRoutes(ctx: AppContext) {
  const app = new Hono<Env>();
  app.use(requireUser(ctx));

  app.get('/changes', (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const limit = Number(c.req.query('limit') ?? 500);
    if (!Number.isInteger(since) || since < 0) throw badRequest('"since" must be a version');
    if (!Number.isInteger(limit) || limit < 1) throw badRequest('"limit" must be positive');
    return c.json(ctx.sync.changes(c.get('user').id, since, Math.min(limit, SYNC_PAGE_MAX)));
  });

  app.post('/push', bodyLimit({ maxSize: 4 * 1024 * 1024 }), async (c) => {
    const body = await jsonBody(c);
    if (!Array.isArray(body.records) || body.records.length > SYNC_PUSH_MAX) {
      throw badRequest(`"records" must be an array of at most ${SYNC_PUSH_MAX}`);
    }
    return c.json(ctx.sync.push(c.get('user').id, body.records as SyncRecord[]));
  });

  // "Something changed": `cursor` (pull sync records after this version) and
  // `articles` (new articles in your feeds). Clients that can hold a connection
  // open (the web reader, the app in the foreground) use this instead of polling.
  app.get('/events', (c) => {
    const userId = c.get('user').id;
    return streamSSE(c, async (stream) => {
      let wake: () => void = () => {};
      let cursor = ctx.sync.cursor(userId);
      let articles = false;
      const unsubscribe = ctx.notifier.subscribe(userId, (event) => {
        if (event.type === 'cursor') cursor = event.cursor;
        else articles = true;
        wake();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake();
      });
      await stream.writeSSE({ event: 'cursor', data: String(cursor) });
      let sent = cursor;
      while (!stream.aborted) {
        // Wake on an event, or every 25 s to keep proxies from closing the stream.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 25_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        if (stream.aborted) break;
        let wrote = false;
        if (cursor !== sent) {
          sent = cursor;
          await stream.writeSSE({ event: 'cursor', data: String(cursor) });
          wrote = true;
        }
        if (articles) {
          articles = false;
          await stream.writeSSE({ event: 'articles', data: '' });
          wrote = true;
        }
        if (!wrote) await stream.write(': ping\n\n');
      }
      unsubscribe();
    });
  });

  return app;
}
