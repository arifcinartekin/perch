import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Env } from './http';

// Serves the web reader (apps/web) from the same origin as the API, so the
// session cookie just works and no CORS is involved.

/** PERCH_WEB_ROOT, else the web build next to this server in the repo. */
export function findWebRoot(configured?: string): string | undefined {
  if (configured) return configured;
  for (const candidate of ['../../web/dist', '../web/dist']) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(`${path}/index.html`)) return path;
  }
  return undefined;
}

// Feed content shows images and media from anywhere; scripts only from here.
// Connections go here, and to the sync chain relay, which may be any https
// server (feeds themselves come through this server). Embedded video only
// from the players the sanitizer lets through (packages/reader lib/sanitize).
// 'wasm-unsafe-eval' lets the page run its own bundled Argon2id.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src *',
  "connect-src 'self' https:",
  'frame-src https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://player.vimeo.com',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function serveWeb(app: Hono<Env>, root: string) {
  app.use('/*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/api/')) return;
    c.header('content-security-policy', CSP);
    // Hashed assets never change; everything else is revalidated so updates land.
    const immutable = c.req.path.startsWith('/assets/') && c.res.status === 200;
    c.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
  app.use('/*', serveStatic({ root }));
  // Client-side routes (/feed/…, /settings) get the app shell. Missing files
  // (anything with an extension) and API paths stay 404s.
  app.get('/*', async (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return next();
    return serveStatic({ root, path: 'index.html' })(c, next);
  });
}
