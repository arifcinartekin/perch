import { feedServer, rss, setup } from './helpers';

describe('feed proxy (hub mode)', () => {
  it('fetches feeds anonymously, caches them and answers conditional requests', async () => {
    const etag = '"v1"';
    const site = await feedServer({
      '/feed.xml': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/rss+xml', etag });
        res.end(rss([{ guid: 'a', title: 'Hello' }]));
      },
      '/binary': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end('x');
      },
    });
    const t = setup({ mode: 'hub' });
    try {
      const get = (url: string, headers: Record<string, string> = {}) =>
        t.app.request(`/api/v1/proxy?url=${encodeURIComponent(url)}`, { headers });
      const first = await get(site.url('/feed.xml'));
      expect(first.status).toBe(200);
      expect(await first.text()).toContain('Hello');
      expect(first.headers.get('etag')).toBe(etag);

      await get(site.url('/feed.xml'));
      expect(site.hits.filter((h) => h === '/feed.xml')).toHaveLength(1);
      expect((await get(site.url('/feed.xml'), { 'if-none-match': etag })).status).toBe(304);

      expect((await get(site.url('/binary'))).status).toBe(415);
      expect((await get('ftp://example.com/x')).status).toBe(400);
    } finally {
      t.close();
      await site.close();
    }
  });

  it('only exists on a hub', async () => {
    const t = setup();
    expect((await t.app.request('/api/v1/proxy?url=https://example.com')).status).toBe(404);
    t.close();
  });

  it('lets any web page use the chain relay', async () => {
    const t = setup({ chain: true });
    const pre = await t.app.request('/api/v1/chain/changes', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://reader.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    t.close();
  });
});

describe('the web app’s security policy', () => {
  it('lets the page reach a chain relay elsewhere and embedded players, nothing else new', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { serveWeb } = await import('../src/web');
    const root = mkdtempSync(join(tmpdir(), 'perch-web-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    const t = setup({ mode: 'hub' });
    try {
      serveWeb(t.app, root);
      const csp = (await t.app.request('/')).headers.get('content-security-policy') ?? '';
      expect(csp).toContain("connect-src 'self' https:");
      expect(csp).toContain('https://www.youtube-nocookie.com');
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    } finally {
      t.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
