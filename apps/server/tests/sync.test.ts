import { feedIdFor } from '@perch/core/feeds';
import { Hlc, formatHlc, stateRecordId, type SyncRecord } from '@perch/core/sync';
import { pruneSyncRecords } from '../src/sync/service';
import { feedServer, rss, setup } from './helpers';

describe('sync API', () => {
  let t: ReturnType<typeof setup>;
  let srv: Awaited<ReturnType<typeof feedServer>>;
  let token: string;
  let laptop: Hlc;
  let phone: Hlc;

  beforeEach(async () => {
    t = setup();
    srv = await feedServer({
      '/feed.xml': (_q, r) =>
        r.writeHead(200, { 'content-type': 'application/rss+xml' }).end(
          rss([
            { guid: 'a', title: 'Hello' },
            { guid: 'b', title: 'World' },
          ]),
        ),
    });
    token = (await t.register('owner')).token;
    laptop = new Hlc('laptop');
    phone = new Hlc('phone');
  });
  afterEach(async () => {
    t.close();
    await srv.close();
  });

  const push = (records: SyncRecord[], tok = token) =>
    t.call('POST', '/sync/push', { token: tok, body: { records } });
  const pull = (since = 0, tok = token) =>
    t.call('GET', `/sync/changes?since=${since}`, { token: tok });
  const feedRecord = (hlc: Hlc, extra = {}): SyncRecord => {
    const url = srv.url('/feed.xml');
    return {
      type: 'feed',
      id: feedIdFor(url),
      hlc: hlc.now(),
      data: { url, title: 'Test', categoryId: 'uncategorized', addedAt: 1, ...extra },
    };
  };

  it('stores pushed records, assigns versions and pages through them', async () => {
    const res = await push([
      feedRecord(laptop),
      { type: 'category', id: 'c1', hlc: laptop.now(), data: { name: 'Tech', order: 10 } },
      { type: 'setting', id: 'theme', hlc: laptop.now(), data: { value: 'dark' } },
    ]);
    expect(res.body.results.map((r: any) => [r.status, r.version])).toEqual([
      ['ok', 1],
      ['ok', 2],
      ['ok', 3],
    ]);
    expect(res.body.cursor).toBe(3);

    const all = await pull();
    expect(all.body.records.map((r: any) => `${r.type}:${r.id}`)).toEqual([
      `feed:${feedIdFor(srv.url('/feed.xml'))}`,
      'category:c1',
      'setting:theme',
    ]);
    expect(all.body).toMatchObject({ cursor: 3, more: false });
    expect((await pull(2)).body.records).toHaveLength(1);

    const paged = await t.call('GET', '/sync/changes?since=0&limit=2', { token });
    expect(paged.body).toMatchObject({ cursor: 2, more: true });
  });

  it('keeps the latest write per key (last writer wins by clock)', async () => {
    const older = {
      type: 'setting' as const,
      id: 'theme',
      hlc: phone.now(),
      data: { value: 'light' },
    };
    await new Promise((r) => setTimeout(r, 2));
    const newer = {
      type: 'setting' as const,
      id: 'theme',
      hlc: laptop.now(),
      data: { value: 'dark' },
    };

    expect((await push([newer])).body.results[0].status).toBe('ok');
    const late = await push([older]);
    expect(late.body.results[0]).toMatchObject({ status: 'stale', version: 1 });
    expect((await t.call('GET', '/reader/settings', { token })).body.settings).toEqual({
      theme: 'dark',
    });
    // A re-sent identical record is also stale, not a new version.
    expect((await push([newer])).body.results[0].status).toBe('stale');
  });

  it('rejects malformed records without failing the batch', async () => {
    const res = await push([
      { ...feedRecord(laptop), id: 'deadbeef' }, // id doesn't match the url
      { type: 'setting', id: 'pinHash', hlc: laptop.now(), data: { value: 'x' } },
      { type: 'state', id: 'no-colon', hlc: laptop.now(), data: { read: true, starred: false } },
      { type: 'category', id: 'c', hlc: 'yesterday', data: { name: 'x', order: 1 } },
      { type: 'category', id: 'ok', hlc: laptop.now(), data: { name: 'Fine', order: 1 } },
    ] as SyncRecord[]);
    expect(res.body.results.map((r: any) => r.status)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'ok',
    ]);
  });

  it('a pushed feed is subscribed, fetched by the server and readable via the reader API', async () => {
    await push([feedRecord(laptop, { customTitle: 'Mine' })]);
    await vi.waitFor(async () => {
      const items = (await t.call('GET', '/reader/articles', { token })).body.items;
      expect(items).toHaveLength(2);
    });
    const lib = (await t.call('GET', '/reader/library', { token })).body;
    expect(lib.feeds[0]).toMatchObject({ customTitle: 'Mine', title: 'Test Blog' });

    // Read state pushed from a device shows up in the reader.
    const items = (await t.call('GET', '/reader/articles', { token })).body.items;
    await push([
      {
        type: 'state',
        id: stateRecordId(items[0].feedId, items[0].id),
        hlc: laptop.now(),
        data: { read: true, starred: true },
      },
    ]);
    const counts = (await t.call('GET', '/reader/counts', { token })).body;
    expect(counts).toEqual({ unread: { [items[0].feedId]: 1 }, starred: 1 });

    // Unsubscribing with a tombstone removes it.
    await push([{ type: 'feed', id: items[0].feedId, hlc: laptop.now(), deleted: true }]);
    expect((await t.call('GET', '/reader/library', { token })).body.feeds).toEqual([]);
  });

  it('changes made through the reader API come out as records for other devices', async () => {
    const { body } = await t.call('POST', '/reader/feeds', {
      token,
      body: { url: srv.url('/feed.xml') },
    });
    const feedId = body.feed.id;
    const cat = (await t.call('POST', '/reader/categories', { token, body: { name: 'News' } })).body
      .category;
    await t.call('PATCH', `/reader/feeds/${feedId}`, { token, body: { categoryId: cat.id } });
    const [first] = (await t.call('GET', '/reader/articles', { token })).body.items;
    await t.call('POST', '/reader/articles/state', {
      token,
      body: { items: [{ feedId, id: first.id }], starred: true },
    });
    await t.call('POST', '/reader/articles/read-all', { token, body: {} });
    await t.call('PUT', '/reader/settings', { token, body: { theme: 'dark', pinHash: 'nope' } });

    const records = (await pull()).body.records;
    const latest = new Map(records.map((r: any) => [`${r.type}:${r.id}`, r]));
    expect(latest.get(`feed:${feedId}`)).toMatchObject({
      data: { url: srv.url('/feed.xml'), categoryId: cat.id, title: 'Test Blog' },
    });
    expect(latest.get(`category:${cat.id}`)).toMatchObject({ data: { name: 'News' } });
    expect(latest.get(`state:${stateRecordId(feedId, first.id)}`)).toMatchObject({
      data: { read: true, starred: true }, // read-all kept the star
    });
    expect([...latest.keys()].filter((k) => String(k).startsWith('state:'))).toHaveLength(2);
    expect(latest.get('setting:theme')).toMatchObject({ data: { value: 'dark' } });
    expect(latest.has('setting:pinHash')).toBe(false);

    // Deleting the category moves its feed and leaves a tombstone.
    await t.call('DELETE', `/reader/categories/${cat.id}`, { token });
    const after = (await pull(records.at(-1).version)).body.records;
    expect(after.map((r: any) => [r.type, r.deleted ?? false, r.data?.categoryId])).toEqual([
      ['feed', false, 'uncategorized'],
      ['category', true, undefined],
    ]);
  });

  it('keeps accounts apart', async () => {
    await push([{ type: 'setting', id: 'theme', hlc: laptop.now(), data: { value: 'dark' } }]);
    const other = await t.register('second');
    expect((await pull(0, other.token)).body).toEqual({ records: [], cursor: 0, more: false });
    const res = await push(
      [{ type: 'setting', id: 'theme', hlc: phone.now(), data: { value: 'light' } }],
      other.token,
    );
    expect(res.body.results[0]).toMatchObject({ status: 'ok', version: 1 });
  });

  it('tells listeners when the cursor moves', async () => {
    const userId = (await t.call('GET', '/auth/me', { token })).body.user.id;
    const seen: number[] = [];
    const stop = t.ctx.sync.subscribe(userId, (cursor) => seen.push(cursor));
    await push([{ type: 'setting', id: 'theme', hlc: laptop.now(), data: { value: 'dark' } }]);
    await push([
      { type: 'setting', id: 'theme', hlc: formatHlc(0, 0, 'old'), data: { value: 'x' } },
    ]);
    stop();
    expect(seen).toEqual([1]); // the stale push didn't notify
  });

  it('prunes old read state and old tombstones, keeping stars', async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = (n: number) => formatHlc(Date.now() - 61 * day, n, 'old');
    await push([
      { type: 'state', id: 'f:a', hlc: old(1), data: { read: true, starred: false } },
      { type: 'state', id: 'f:b', hlc: old(2), data: { read: true, starred: true } },
      {
        type: 'category',
        id: 'gone',
        hlc: formatHlc(Date.now() - 91 * day, 0, 'old'),
        deleted: true,
      },
      { type: 'state', id: 'f:c', hlc: laptop.now(), data: { read: true, starred: false } },
    ]);
    pruneSyncRecords(t.ctx.db);
    expect((await pull()).body.records.map((r: any) => r.id)).toEqual(['f:b', 'f:c']);
  });

  it('requires a session', async () => {
    expect((await t.call('GET', '/sync/changes')).status).toBe(401);
  });
});
