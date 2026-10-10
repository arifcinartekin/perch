import { Hono } from 'hono';
import { HttpError, badRequest, clientIp, type AppContext, type Env } from '../http';
import { RateLimiter } from '../lib/ratelimit';
import { ResponseTooLargeError, readTextLimited } from '../lib/safe-fetch';

// Feeds and pages for the web reader on a hub. A web page can't fetch other
// sites itself (CORS), so it asks here. It's anonymous: no session is read,
// nothing is logged, and a short shared cache means a popular feed is fetched
// once for everyone, so the server learns which feeds are popular, not who
// reads them. Only feeds, pages and JSON pass; everything else is refused.

const MAX_BYTES = 5 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const TYPES = /(xml|rss|atom|json|html|text\/plain)/i;

interface Cached {
  status: number;
  body: string;
  contentType: string;
  etag?: string;
  lastModified?: string;
  url: string;
  at: number;
}

export function proxyRoutes(ctx: AppContext) {
  const app = new Hono<Env>();
  const limit = new RateLimiter(600, 60 * 60 * 1000);
  const cache = new Map<string, Cached>();

  const remember = (key: string, entry: Cached) => {
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  };

  app.get('/', async (c) => {
    const ip = clientIp(c, ctx.config);
    const wait = limit.retryAfter(ip);
    if (wait > 0)
      throw new HttpError(429, 'rate-limited', `Too many requests; try again in ${wait}s`);
    limit.hit(ip);

    const raw = c.req.query('url') ?? '';
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw badRequest('"url" must be an http(s) address');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw badRequest('"url" must be an http(s) address');
    }
    url.hash = '';
    const key = url.toString();

    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > TTL_MS) {
      let res: Awaited<ReturnType<typeof ctx.fetch>>;
      try {
        res = await ctx.fetch(key, {
          headers: {
            accept:
              c.req.header('accept') ??
              'application/rss+xml, application/atom+xml, application/feed+json, text/html;q=0.9, */*;q=0.5',
          },
        });
      } catch (err) {
        throw new HttpError(
          502,
          'fetch-failed',
          `Couldn’t reach ${url.host}: ${(err as Error).message}`,
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType && !TYPES.test(contentType)) {
        await res.body?.cancel();
        throw new HttpError(415, 'not-a-feed', 'Only feeds and web pages are fetched');
      }
      let body: string;
      try {
        body = await readTextLimited(res, MAX_BYTES);
      } catch (err) {
        if (err instanceof ResponseTooLargeError)
          throw new HttpError(413, 'too-large', err.message);
        throw new HttpError(502, 'fetch-failed', (err as Error).message);
      }
      entry = {
        status: res.status,
        body,
        contentType: contentType || 'text/plain',
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        url: res.url || key,
        at: Date.now(),
      };
      if (res.ok) remember(key, entry);
    }

    c.header('cache-control', 'no-store');
    c.header('x-perch-final-url', entry.url);
    if (entry.etag) c.header('etag', entry.etag);
    if (entry.lastModified) c.header('last-modified', entry.lastModified);
    const fresh =
      entry.status === 200 &&
      ((entry.etag && c.req.header('if-none-match') === entry.etag) ||
        (!entry.etag &&
          entry.lastModified &&
          c.req.header('if-modified-since') === entry.lastModified));
    if (fresh) return c.body(null, 304);
    c.header('content-type', entry.contentType);
    return c.body(
      entry.body,
      (entry.status >= 200 && entry.status < 600 ? entry.status : 502) as 200,
    );
  });

  return app;
}
