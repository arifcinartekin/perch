import { setup } from './helpers';

const ID = 'feed1:article1';
const sharePath = `/shares/${encodeURIComponent(ID)}`;
const note = { title: 'An article', url: 'https://blog.example/a', feedTitle: 'Blog', body: 'Hi' };

describe('hub mode', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({ mode: 'hub', publicUrl: 'https://app.perch.test' });
  });
  afterEach(() => t.close());

  it('has accounts but no libraries', async () => {
    expect((await t.call('GET', '/server')).body.mode).toBe('hub');
    const { token } = await t.register('owner');
    for (const path of ['/reader/library', '/sync/changes?since=0', '/notes']) {
      const res = await t.call('GET', path, { token });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('hub');
    }
    expect((await t.call('GET', '/auth/me', { token })).status).toBe(200);
  });

  it('publishes a note sent with the request, updates it, lists it and takes it down', async () => {
    const { token } = await t.register('owner');
    expect((await t.call('PUT', sharePath, { token, body: {} })).body.error).toBe('note-not-found');
    const shared = await t.call('PUT', sharePath, { token, body: note });
    expect(shared.status).toBe(200);
    const page = new URL(shared.body.url).pathname;
    expect(await (await t.app.request(page)).text()).toContain('Hi');

    const again = await t.call('PUT', sharePath, { token, body: { ...note, body: 'Edited' } });
    expect(again.body.url).toBe(shared.body.url);
    expect(await (await t.app.request(page)).text()).toContain('Edited');

    const list = await t.call('GET', '/shares', { token });
    expect(list.body.shares).toMatchObject([
      { noteId: ID, url: shared.body.url, title: 'An article' },
    ]);

    await t.call('DELETE', sharePath, { token });
    expect((await t.app.request(page)).status).toBe(404);
    expect((await t.call('GET', '/shares', { token })).body.shares).toEqual([]);
  });
});

describe('switching a personal server to hub mode', () => {
  it('keeps libraries until asked, then deletes them and keeps the accounts', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'perch-hub-'));
    const databasePath = join(dir, 'perch.db');
    const count = (t: ReturnType<typeof setup>) =>
      (t.ctx.db as unknown as { $client: import('better-sqlite3').Database }).$client
        .prepare('select count(*) as n from sync_records')
        .get() as { n: number };
    try {
      const personal = setup({ databasePath });
      const { token, authKey } = await personal.register('owner');
      await personal.call('PUT', `/notes/${encodeURIComponent('f:a')}`, {
        token,
        body: { title: 'T', body: 'private' },
      });
      personal.close();

      const kept = setup({ databasePath, mode: 'hub' });
      expect(count(kept).n).toBeGreaterThan(0);
      kept.close();

      const purged = setup({ databasePath, mode: 'hub', purgeLibraries: true });
      expect(count(purged).n).toBe(0);
      const login = await purged.call('POST', '/auth/login', {
        body: { username: 'owner', authKey },
      });
      expect(login.status).toBe(200);
      purged.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
