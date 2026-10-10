import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { ApiError, AuthResponse } from '@perch/core/api';
import { DEFAULT_KDF } from '@perch/core/auth';
import { createApp, createContext } from '../src/app';
import { testConfig, type Config } from '../src/config';
import { MemoryMailer } from '../src/lib/mailer';

export function setup(overrides: Partial<Config> = {}, opts: { email?: boolean } = {}) {
  const mailer = opts.email ? new MemoryMailer() : undefined;
  const ctx = createContext(testConfig(overrides), { mailer });
  const app = createApp(ctx);

  async function call<T = any>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; raw?: string } = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers,
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON (OPML)
    }
    return { status: res.status, body, headers: res.headers };
  }

  /** Register an account. The auth key stands in for the client's Argon2id output. */
  async function register(username: string, extra: Record<string, unknown> = {}) {
    const authKey = randomBytes(32).toString('base64url');
    const res = await call<AuthResponse & ApiError>('POST', '/auth/register', {
      body: {
        username,
        authKey,
        salt: randomBytes(16).toString('base64url'),
        kdf: DEFAULT_KDF,
        ...extra,
      },
    });
    return { ...res, authKey, token: res.body.token };
  }

  return { ctx, app, call, register, mailer, close: () => ctx.close() };
}

export type Route = (req: IncomingMessage, res: ServerResponse) => void;

/** A throwaway HTTP server for feeds. Routes can be swapped between requests. */
export async function feedServer(routes: Record<string, Route>) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const route = routes[req.url ?? ''];
    if (route) return route(req, res);
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    routes,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function rss(items: { guid: string; title: string; body?: string; date?: string }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Blog</title><link>https://blog.example/</link>
  ${items
    .map(
      (i) => `<item><guid>${i.guid}</guid><title>${i.title}</title>
      <link>https://blog.example/${i.guid}</link>
      <description><![CDATA[${i.body ?? ''}]]></description>
      <pubDate>${i.date ?? 'Mon, 05 Oct 2026 10:00:00 GMT'}</pubDate></item>`,
    )
    .join('\n')}
</channel></rss>`;
}
