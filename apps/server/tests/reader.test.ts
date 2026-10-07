import { eq } from 'drizzle-orm';
import { feeds } from '../src/db/schema';
import { maintenance } from '../src/feeds/worker';
import { feedServer, rss, setup } from './helpers';

const ITEMS = [
  {
    guid: 'a',
    title: 'İstanbul’da yağmur',
    body: '<p>Hava <b>çok</b> güzel değil</p>',
    date: 'Mon, 05 Oct 2026 10:00:00 GMT',
  },
  { guid: 'b', title: 'Second post', body: 'About cafés', date: 'Tue, 06 Oct 2026 10:00:00 GMT' },
  {
    guid: 'c',
    title: 'Third post',
    body: 'Nothing special',
    date: 'Wed, 07 Oct 2026 10:00:00 GMT',
  },
];

describe('reader API', () => {
  let t: ReturnType<typeof setup>;
  let srv: Awaited<ReturnType<typeof feedServer>>;
  let token: string;
  let etag = '"v1"';

  beforeEach(async () => {
    t = setup();
    etag = '"v1"';
    srv = await feedServer({
      '/feed.xml': (req, res) => {
        if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
        res.writeHead(200, { 'content-type': 'application/rss+xml', etag }).end(rss(ITEMS));
      },
      '/': (_req, res) =>
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
          ),
      '/plain': (_req, res) =>
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html>no feed</html>'),
    });
    token = (await t.register('owner')).token;
  });
  afterEach(async () => {
    t.close();
    await srv.close();
  });

  const subscribe = (url: string, extra = {}) =>
    t.call('POST', '/reader/feeds', { token, body: { url, ...extra } });

  it('subscribes from a page URL via its <link> tag and stores the articles', async () => {
    const res = await subscribe(srv.url('/'));
    expect(res.status).toBe(200);
    expect(res.body.feed).toMatchObject({
      url: srv.url('/feed.xml'),
      title: 'Test Blog',
      categoryId: 'uncategorized',
    });

    const list = await t.call('GET', '/reader/articles', { token });
    expect(list.body.items.map((a: any) => a.title)).toEqual([
      'Third post',
      'Second post',
      'İstanbul’da yağmur',
    ]);
    expect(list.body.items[0]).toMatchObject({
      read: 0,
      starred: 0,
      url: 'https://blog.example/c',
    });

    const library = await t.call('GET', '/reader/library', { token });
    expect(library.body.feeds).toHaveLength(1);
    expect(library.body.categories.map((c: any) => c.id)).toEqual(['uncategorized']);
  });

  it('probes well-known paths when the page has no <link>', async () => {
    const res = await subscribe(srv.url('/plain'));
    expect(res.body.feed?.url).toBe(srv.url('/feed.xml'));
  });

  it('explains when there is no feed', async () => {
    delete srv.routes['/feed.xml'];
    const res = await subscribe(srv.url('/plain'));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('no-feed-found');
  });

  it('refuses to fetch private addresses unless allowed', async () => {
    const locked = setup({ fetchAllowPrivate: false });
    try {
      const owner = await locked.register('owner');
      const res = await locked.call('POST', '/reader/feeds', {
        token: owner.token,
        body: { url: srv.url('/feed.xml') },
      });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/private or reserved/);
    } finally {
      locked.close();
    }
  });

  it('searches accent- and case-insensitively, and pages with a cursor', async () => {
    await subscribe(srv.url('/feed.xml'));
    const search = async (q: string) =>
      (
        await t.call('GET', `/reader/articles?q=${encodeURIComponent(q)}`, { token })
      ).body.items.map((a: any) => a.id);
    expect(await search('istanbul')).toHaveLength(1);
    expect(await search('COK guzel')).toHaveLength(1); // matches body text, not tags
    expect(await search('cafe')).toHaveLength(1);
    expect(await search('100%')).toHaveLength(0);
    expect(await search('<b>')).toHaveLength(0);

    const first = await t.call('GET', '/reader/articles?limit=2', { token });
    expect(first.body.items).toHaveLength(2);
    const second = await t.call('GET', `/reader/articles?limit=2&before=${first.body.next}`, {
      token,
    });
    expect(second.body.items.map((a: any) => a.title)).toEqual(['İstanbul’da yağmur']);
    expect(second.body.next).toBeNull();
  });

  it('marks read and starred, counts unread, and marks all read', async () => {
    const { body } = await subscribe(srv.url('/feed.xml'));
    const feedId = body.feed.id;
    const list = (await t.call('GET', '/reader/articles', { token })).body.items;

    expect((await t.call('GET', '/reader/counts', { token })).body).toEqual({
      unread: { [feedId]: 3 },
      starred: 0,
    });

    await t.call('POST', '/reader/articles/state', {
      token,
      body: { items: [{ feedId, id: list[0].id }], read: true },
    });
    await t.call('POST', '/reader/articles/state', {
      token,
      body: {
        items: [
          { feedId, id: list[0].id },
          { feedId, id: 'nope' },
        ],
        starred: true,
      },
    });
    const one = (await t.call('GET', `/reader/articles/${feedId}/${list[0].id}`, { token })).body;
    expect(one.article).toMatchObject({ read: 1, starred: 1 });

    expect((await t.call('GET', '/reader/counts', { token })).body).toEqual({
      unread: { [feedId]: 2 },
      starred: 1,
    });
    expect((await t.call('GET', '/reader/articles?unread=1', { token })).body.items).toHaveLength(
      2,
    );
    expect((await t.call('GET', '/reader/articles?starred=1', { token })).body.items).toHaveLength(
      1,
    );

    const all = await t.call('POST', '/reader/articles/read-all', {
      token,
      body: { feed: feedId },
    });
    expect(all.body.marked).toBe(2);
    expect((await t.call('GET', '/reader/counts', { token })).body.unread).toEqual({});
    // Marking read didn't clear the star.
    expect((await t.call('GET', '/reader/counts', { token })).body.starred).toBe(1);
  });

  it("keeps each user's state separate and fetches a shared feed once", async () => {
    await subscribe(srv.url('/feed.xml'));
    const other = await t.register('second');
    srv.hits.length = 0;
    const res = await t.call('POST', '/reader/feeds', {
      token: other.token,
      body: { url: srv.url('/feed.xml') },
    });
    expect(res.status).toBe(200);
    expect(srv.hits).toEqual([]); // already known: no new request

    const mine = (await t.call('GET', '/reader/articles', { token })).body.items;
    await t.call('POST', '/reader/articles/read-all', { token, body: {} });
    expect(mine).toHaveLength(3);
    const theirs = (await t.call('GET', '/reader/articles?unread=1', { token: other.token })).body;
    expect(theirs.items).toHaveLength(3);
  });

  it('refreshes with conditional GET and picks up new items', async () => {
    const { body } = await subscribe(srv.url('/feed.xml'));
    const feedId = body.feed.id;

    const notModified = await t.call('POST', '/reader/refresh', { token, body: {} });
    expect(notModified.body).toEqual({ refreshed: 1, failed: 0 });

    etag = '"v2"';
    ITEMS.push({ guid: 'd', title: 'Fresh', body: '', date: 'Wed, 07 Oct 2026 12:00:00 GMT' });
    try {
      await t.call('POST', '/reader/refresh', { token, body: { feed: feedId } });
      const titles = (await t.call('GET', '/reader/articles', { token })).body.items.map(
        (a: any) => a.title,
      );
      expect(titles[0]).toBe('Fresh');
      expect(titles).toHaveLength(4);
    } finally {
      ITEMS.pop();
    }
  });

  it('records fetch errors and backs off', async () => {
    const { body } = await subscribe(srv.url('/feed.xml'));
    srv.routes['/feed.xml'] = (_req, res) => res.writeHead(500).end();
    const res = await t.call('POST', '/reader/refresh', { token, body: {} });
    expect(res.body).toEqual({ refreshed: 0, failed: 1 });
    const row = t.ctx.db.select().from(feeds).where(eq(feeds.id, body.feed.id)).get()!;
    expect(row.lastError).toBe('HTTP 500 Internal Server Error');
    expect(row.errorCount).toBe(1);
    const library = await t.call('GET', '/reader/library', { token });
    expect(library.body.feeds[0].lastError).toBe('HTTP 500 Internal Server Error');
  });

  it('manages categories and moves feeds back to Uncategorized on delete', async () => {
    const { body } = await subscribe(srv.url('/feed.xml'));
    const tech = (await t.call('POST', '/reader/categories', { token, body: { name: 'Tech' } }))
      .body.category;
    // Same name, different case → same category.
    const again = await t.call('POST', '/reader/categories', { token, body: { name: 'tech' } });
    expect(again.body.category.id).toBe(tech.id);

    await t.call('PATCH', `/reader/feeds/${body.feed.id}`, {
      token,
      body: { categoryId: tech.id, customTitle: 'My blog' },
    });
    let library = (await t.call('GET', '/reader/library', { token })).body;
    expect(library.feeds[0]).toMatchObject({ categoryId: tech.id, customTitle: 'My blog' });
    expect(
      (await t.call('GET', `/reader/articles?category=${tech.id}`, { token })).body.items,
    ).toHaveLength(3);

    await t.call('PATCH', '/reader/categories/uncategorized', { token, body: { collapsed: true } });
    await t.call('DELETE', `/reader/categories/${tech.id}`, { token });
    library = (await t.call('GET', '/reader/library', { token })).body;
    expect(library.feeds[0].categoryId).toBe('uncategorized');
    expect(library.categories).toEqual([
      { id: 'uncategorized', name: 'Uncategorized', order: 1000, collapsed: true },
    ]);

    const bad = await t.call('PATCH', `/reader/feeds/${body.feed.id}`, {
      token,
      body: { categoryId: 'x' },
    });
    expect(bad.status).toBe(400);
  });

  it('round-trips OPML', async () => {
    await subscribe(srv.url('/feed.xml'));
    const tech = (await t.call('POST', '/reader/categories', { token, body: { name: 'Tech' } }))
      .body.category;
    const feedId = (await t.call('GET', '/reader/library', { token })).body.feeds[0].id;
    await t.call('PATCH', `/reader/feeds/${feedId}`, { token, body: { categoryId: tech.id } });

    const opml = await t.call('GET', '/reader/opml', { token });
    expect(opml.headers.get('content-type')).toMatch(/opml/);
    expect(opml.body).toContain(srv.url('/feed.xml'));

    const other = await t.register('second');
    const imported = await t.call('POST', '/reader/opml', { token: other.token, raw: opml.body });
    expect(imported.body).toEqual({ added: 1, existing: 0, categories: 1 });
    const lib = (await t.call('GET', '/reader/library', { token: other.token })).body;
    expect(lib.categories.map((c: any) => c.name)).toEqual(['Tech', 'Uncategorized']);
    expect(lib.feeds[0].categoryId).toBe(lib.categories[0].id);

    const twice = await t.call('POST', '/reader/opml', { token: other.token, raw: opml.body });
    expect(twice.body).toEqual({ added: 0, existing: 1, categories: 0 });
  });

  it('keeps starred articles after unsubscribing, and cleans up orphan feeds', async () => {
    const { body } = await subscribe(srv.url('/feed.xml'));
    const feedId = body.feed.id;
    const [first] = (await t.call('GET', '/reader/articles', { token })).body.items;
    await t.call('POST', '/reader/articles/state', {
      token,
      body: { items: [{ feedId, id: first.id }], starred: true },
    });

    await t.call('DELETE', `/reader/feeds/${feedId}`, { token });
    expect((await t.call('GET', '/reader/library', { token })).body.feeds).toEqual([]);
    expect(
      (await t.call('GET', '/reader/articles', { token })).body.items.map((a: any) => a.id),
    ).toEqual([first.id]);

    const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
    maintenance(t.ctx.db, later);
    expect(t.ctx.db.select().from(feeds).all()).toHaveLength(1); // a star keeps it

    await t.call('POST', '/reader/articles/state', {
      token,
      body: { items: [{ feedId, id: first.id }], starred: false },
    });
    maintenance(t.ctx.db, later);
    expect(t.ctx.db.select().from(feeds).all()).toHaveLength(0);
  });

  it('stores synced settings but never the PIN or wallpaper', async () => {
    await t.call('PUT', '/reader/settings', {
      token,
      body: { theme: 'dark', pinHash: 'x', pinSalt: 'y', wallpaper: { id: '1', dim: 3, blur: 0 } },
    });
    expect((await t.call('GET', '/reader/settings', { token })).body.settings).toEqual({
      theme: 'dark',
    });
  });

  it('requires a session', async () => {
    expect((await t.call('GET', '/reader/library')).status).toBe(401);
  });
});

describe('full text', () => {
  it('extracts the article page with Readability and caches it', async () => {
    const t = setup();
    const page = `<html><head><title>Post</title></head><body><nav>menu</nav><article><h1>Post</h1>${'<p>Readable paragraph text that goes on for a while. </p>'.repeat(20)}<a href="/rel">link</a></article></body></html>`;
    let pageHits = 0;
    const srv = await feedServer({
      '/post': (_q, r) => {
        pageHits++;
        r.writeHead(200, { 'content-type': 'text/html' }).end(page);
      },
    });
    // The feed links to the article page on the same test server.
    srv.routes['/feed.xml'] = (_q, r) =>
      r
        .writeHead(200, { 'content-type': 'application/rss+xml' })
        .end(
          rss([{ guid: 'p', title: 'Post' }]).replace('https://blog.example/p', srv.url('/post')),
        );
    try {
      const { token } = await t.register('owner');
      await t.call('POST', '/reader/feeds', { token, body: { url: srv.url('/feed.xml') } });
      const [a] = (await t.call('GET', '/reader/articles', { token })).body.items;
      const first = await t.call('GET', `/reader/articles/${a.feedId}/${a.id}/fulltext`, { token });
      expect(first.status).toBe(200);
      expect(first.body.fullText.html).toContain('Readable paragraph text');
      expect(first.body.fullText.html).not.toContain('menu');
      await t.call('GET', `/reader/articles/${a.feedId}/${a.id}/fulltext`, { token });
      expect(pageHits).toBe(1); // cached
      await t.call('GET', `/reader/articles/${a.feedId}/${a.id}/fulltext?force=1`, { token });
      expect(pageHits).toBe(2);

      srv.routes['/post'] = (_q, r) => r.writeHead(404).end();
      const failed = await t.call('GET', `/reader/articles/${a.feedId}/${a.id}/fulltext?force=1`, {
        token,
      });
      expect(failed.status).toBe(422);
      expect(failed.body).toMatchObject({ error: 'fetch-failed', message: 'HTTP 404' });
    } finally {
      t.close();
      await srv.close();
    }
  });
});
