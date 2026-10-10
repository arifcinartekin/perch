import 'fake-indexeddb/auto';

// A page-like world for the web reader's code: window, location, and a fetch
// that answers like a hub (the proxy) would.
const served = new Map<string, { body: string; type: string }>();
const calls: { url: string; credentials?: RequestCredentials }[] = [];
const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input), 'https://app.perch.test');
  calls.push({ url: url.toString(), credentials: init.credentials });
  if (url.pathname === '/api/v1/proxy') {
    const hit = served.get(url.searchParams.get('url')!);
    return hit
      ? new Response(hit.body, { headers: { 'content-type': hit.type } })
      : new Response('nope', { status: 404 });
  }
  return new Response('{}', { headers: { 'content-type': 'application/json' } });
};
Object.assign(globalThis, {
  window: globalThis,
  location: new URL('https://app.perch.test/'),
  fetch: fakeFetch,
});

const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`;
const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
  <link>https://blog.example/</link>
  <item><guid>a</guid><title>Hello</title><link>https://blog.example/a</link></item>
</channel></rss>`;

describe('the web reader on a hub', () => {
  it('sends other sites through the proxy, without cookies, and its own API with them', async () => {
    const { routeFetchThroughProxy } = await import('../src/local/net');
    routeFetchThroughProxy();
    calls.length = 0;
    await fetch('https://blog.example/feed.xml');
    await fetch('/api/v1/shares');
    await fetch('https://sync.perch.ws/api/v1/chain/changes');
    expect(calls).toEqual([
      {
        url: `https://app.perch.test/api/v1/proxy?url=${encodeURIComponent('https://blog.example/feed.xml')}`,
        credentials: 'omit',
      },
      { url: 'https://app.perch.test/api/v1/shares', credentials: 'same-origin' },
      { url: 'https://sync.perch.ws/api/v1/chain/changes', credentials: undefined },
    ]);
  });

  it('keeps the extension’s storage in IndexedDB and tells watchers', async () => {
    const { getLocal, setLocal, watchLocal } = await import('@/lib/storage/local');
    const seen: unknown[] = [];
    const stop = watchLocal('perch:test', (v) => seen.push(v));
    await setLocal('perch:test', { a: 1 });
    expect(await getLocal('perch:test', null)).toEqual({ a: 1 });
    expect(seen).toEqual([{ a: 1 }]);
    stop();
  });

  it('adds a feed from a site’s address and fetches it, in the page', async () => {
    served.set('https://blog.example/', { body: page, type: 'text/html' });
    served.set('https://blog.example/feed.xml', { body: feed, type: 'application/rss+xml' });
    const { startLocalWorker } = await import('../src/local/worker');
    const { localBackend } = await import('@/lib/backend');
    startLocalWorker();

    const res = await localBackend.addFeed('https://blog.example/', {
      categoryId: 'uncategorized',
    });
    expect(res.created).toBe(true);
    const { feeds } = await localBackend.loadLibrary();
    expect(feeds.map((f) => f.url)).toEqual(['https://blog.example/feed.xml']);

    await localBackend.refresh([feeds[0]!.id]);
    const page1 = await localBackend.listArticles({
      scope: { kind: 'all' },
      feedIds: [feeds[0]!.id],
      unreadOnly: false,
      limit: 10,
    } as Parameters<typeof localBackend.listArticles>[0]);
    expect(page1.items.map((a) => a.title)).toEqual(['Hello']);
  });
});
