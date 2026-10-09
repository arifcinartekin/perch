import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ChainCreateResponse, ChainRecord } from '@perch/core/chain';
import { SYNC_PAGE_MAX, SYNC_PUSH_MAX } from '@perch/core/sync';
import { HttpError, badRequest, clientIp, jsonBody, type AppContext } from '../http';
import { sha256 } from '../lib/crypto';
import { RateLimiter } from '../lib/ratelimit';
import { ChainService } from './service';

// /api/v1/chain: the relay for sync chains. A chain is addressed by the token
// its devices derive from the chain's code; the relay stores only the token's
// hash. On a server where PERCH_CHAIN is off, every route answers 404.

type ChainEnv = { Variables: { chainId: string } };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function chainRoutes(ctx: AppContext) {
  const app = new Hono<ChainEnv>();
  const chains = new ChainService(ctx.db);
  // Creating chains is cheap for a client and costs us a row; reading and
  // writing an existing one needs its token, which can't be guessed.
  const createLimit = new RateLimiter(10, 60 * 60 * 1000);

  app.use(async (c, next) => {
    if (!ctx.config.chain)
      throw new HttpError(404, 'chain-off', 'This server doesn’t relay chains');
    const header = c.req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!TOKEN.test(token)) throw new HttpError(401, 'unauthorized', 'Missing chain token');
    c.set('chainId', sha256(token));
    await next();
  });

  const existing: MiddlewareHandler<ChainEnv> = async (c, next) => {
    if (!chains.touch(c.get('chainId'))) {
      throw new HttpError(404, 'chain-not-found', 'No chain with this code');
    }
    await next();
  };

  app.post('/', (c) => {
    const id = c.get('chainId');
    if (chains.touch(id)) {
      return c.json<ChainCreateResponse>({ created: false, cursor: chains.cursor(id) });
    }
    const ip = clientIp(c, ctx.config);
    const wait = createLimit.retryAfter(ip);
    if (wait > 0) {
      throw new HttpError(429, 'rate-limited', `Too many new chains; try again in ${wait}s`);
    }
    createLimit.hit(ip);
    chains.create(id);
    return c.json<ChainCreateResponse>({ created: true, cursor: 0 }, 201);
  });

  app.get('/changes', existing, (c) => {
    const since = Number(c.req.query('since') ?? 0);
    const limit = Number(c.req.query('limit') ?? 500);
    if (!Number.isInteger(since) || since < 0) throw badRequest('"since" must be a version');
    if (!Number.isInteger(limit) || limit < 1) throw badRequest('"limit" must be positive');
    return c.json(chains.changes(c.get('chainId'), since, Math.min(limit, SYNC_PAGE_MAX)));
  });

  app.post('/push', existing, bodyLimit({ maxSize: 8 * 1024 * 1024 }), async (c) => {
    const body = await jsonBody(c);
    if (!Array.isArray(body.records) || body.records.length > SYNC_PUSH_MAX) {
      throw badRequest(`"records" must be an array of at most ${SYNC_PUSH_MAX}`);
    }
    return c.json(chains.push(c.get('chainId'), body.records as ChainRecord[]));
  });

  /** Removes the chain and everything in it, for every device. */
  app.delete('/', existing, (c) => {
    chains.delete(c.get('chainId'));
    return c.body(null, 204);
  });

  return app;
}
