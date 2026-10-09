import {
  deriveChainKeys,
  newChainSecret,
  openRecord,
  sealRecord,
  type ChainKeys,
  type ChainRecord,
} from '@perch/core/chain';
import { Hlc, type SyncRecord } from '@perch/core/sync';
import { eq, sql } from 'drizzle-orm';
import { chainRecords, chains } from '../src/db/schema';
import { CHAIN_RECORDS_MAX, pruneChains } from '../src/chain/service';
import { setup } from './helpers';

describe('chain relay', () => {
  let t: ReturnType<typeof setup>;
  let keys: ChainKeys;
  let laptop: Hlc;
  let phone: Hlc;

  beforeEach(async () => {
    t = setup({ chain: true });
    keys = await deriveChainKeys(newChainSecret());
    laptop = new Hlc('laptop');
    phone = new Hlc('phone');
  });
  afterEach(() => t.close());

  const create = (token = keys.token) => t.call('POST', '/chain', { token, body: {} });
  const push = (records: ChainRecord[], token = keys.token) =>
    t.call('POST', '/chain/push', { token, body: { records } });
  const pull = (since = 0, token = keys.token, limit?: number) =>
    t.call('GET', `/chain/changes?since=${since}${limit ? `&limit=${limit}` : ''}`, { token });
  const category = (hlc: Hlc, name: string): SyncRecord => ({
    type: 'category',
    id: 'c1',
    hlc: hlc.now(),
    data: { name, order: 10 },
  });

  it('is off unless the server enables it', async () => {
    const off = setup();
    const res = await off.call('POST', '/chain', { token: keys.token, body: {} });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('chain-off');
    expect((await off.call('GET', '/server')).body.chain).toBe(false);
    expect((await t.call('GET', '/server')).body.chain).toBe(true);
    off.close();
  });

  it('creates a chain once and knows it afterwards', async () => {
    expect(await create()).toMatchObject({ status: 201, body: { created: true, cursor: 0 } });
    expect(await create()).toMatchObject({ status: 200, body: { created: false, cursor: 0 } });
    // Only the token's hash is stored.
    const rows = t.ctx.db.select().from(chains).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(keys.token);
  });

  it('refuses unknown chains and malformed tokens', async () => {
    const other = await deriveChainKeys(newChainSecret());
    expect((await pull(0, other.token)).body.error).toBe('chain-not-found');
    expect((await pull(0, 'short')).status).toBe(401);
    expect((await t.call('GET', '/chain/changes?since=0')).status).toBe(401);
  });

  it('relays sealed records between devices, last writer winning per slot', async () => {
    await create();
    const first = await sealRecord(keys, category(laptop, 'Tech'));
    expect((await push([first])).body.results).toEqual([
      { key: first.key, status: 'ok', version: 1 },
    ]);

    // The phone pulls, decrypts and sees the laptop's category.
    const page = (await pull()).body;
    expect(page.cursor).toBe(1);
    const opened = await openRecord(keys, page.records[0]);
    expect(opened).toMatchObject({ type: 'category', id: 'c1', data: { name: 'Tech' } });
    phone.receive(page.records[0].hlc);

    // A newer write replaces it; replaying the old one is stale.
    const renamed = await sealRecord(keys, category(phone, 'News'));
    expect((await push([renamed])).body.results[0]).toMatchObject({ status: 'ok', version: 2 });
    expect((await push([first])).body.results[0]).toMatchObject({ status: 'stale', version: 2 });

    const all = (await pull()).body.records;
    expect(all).toHaveLength(1);
    expect((await openRecord(keys, all[0]))?.data).toEqual({ name: 'News', order: 10 });
    expect((await pull(2)).body).toEqual({ records: [], cursor: 2, more: false });
  });

  it('keeps chains apart', async () => {
    const other = await deriveChainKeys(newChainSecret());
    await create();
    await create(other.token);
    await push([await sealRecord(keys, category(laptop, 'Mine'))]);
    expect((await pull(0, other.token)).body.records).toEqual([]);
  });

  it('pages through changes', async () => {
    await create();
    const records = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sealRecord(keys, {
          type: 'category',
          id: `c${i}`,
          hlc: laptop.now(),
          data: { name: `C${i}`, order: i },
        }),
      ),
    );
    await push(records);
    const one = (await pull(0, keys.token, 3)).body;
    expect(one.records.map((r: ChainRecord & { version: number }) => r.version)).toEqual([1, 2, 3]);
    expect(one.more).toBe(true);
    const two = (await pull(one.cursor, keys.token, 3)).body;
    expect(two.records).toHaveLength(2);
    expect(two.more).toBe(false);
  });

  it('marks invalid records without storing them', async () => {
    await create();
    const good = await sealRecord(keys, category(laptop, 'Tech'));
    const res = await push([
      { ...good, key: 'feed:abc' },
      { ...good, hlc: 'yesterday' },
      { ...good, blob: 'tiny' },
      { ...good, blob: 'A'.repeat(20_000) },
      null as unknown as ChainRecord,
      good,
    ]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'ok',
    ]);
    expect((await pull()).body.records).toHaveLength(1);
  });

  it('caps how many records a chain holds', async () => {
    await create();
    const chainId = t.ctx.db.select().from(chains).get()!.id;
    // Fill the chain directly, then try one more.
    t.ctx.db.run(sql`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < ${CHAIN_RECORDS_MAX})
      insert into chain_records (chain_id, key, hlc, blob, version, updated_at)
      select ${chainId}, printf('k%021d', i), '1700000000000-0000-x', ${'A'.repeat(40)}, i, 0
      from n`);
    const extra = await sealRecord(keys, category(laptop, 'One too many'));
    expect((await push([extra])).body.results[0].status).toBe('invalid');
  });

  it('deletes a chain for every device', async () => {
    await create();
    await push([await sealRecord(keys, category(laptop, 'Tech'))]);
    expect((await t.call('DELETE', '/chain', { token: keys.token })).status).toBe(204);
    expect((await pull()).body.error).toBe('chain-not-found');
    expect(t.ctx.db.select().from(chainRecords).all()).toEqual([]);
  });

  it('forgets old ephemeral state, old tombstones and abandoned chains', async () => {
    await create();
    const day = 24 * 60 * 60 * 1000;
    const state = (read: boolean, starred: boolean, id: string) =>
      sealRecord(keys, { type: 'state', id, hlc: laptop.now(), data: { read, starred } });
    await push([
      await state(true, false, 'f:read'),
      await state(true, true, 'f:starred'),
      await sealRecord(keys, { type: 'feed', id: 'gone', hlc: laptop.now(), deleted: true }),
    ]);
    const chainId = t.ctx.db.select().from(chains).get()!.id;

    pruneChains(t.ctx.db, Date.now() + 61 * day);
    expect((await pull()).body.records).toHaveLength(2);
    pruneChains(t.ctx.db, Date.now() + 91 * day);
    const left = (await pull()).body.records;
    expect(left).toHaveLength(1);
    expect((await openRecord(keys, left[0]))?.id).toBe('f:starred');

    pruneChains(t.ctx.db, Date.now() + 181 * day);
    expect(t.ctx.db.select().from(chains).where(eq(chains.id, chainId)).all()).toEqual([]);
  });

  it('limits how fast one address creates chains', async () => {
    for (let i = 0; i < 10; i++) {
      const k = await deriveChainKeys(newChainSecret());
      expect((await create(k.token)).status).toBe(201);
      if (i === 0) keys = k;
    }
    const k = await deriveChainKeys(newChainSecret());
    expect((await create(k.token)).status).toBe(429);
    // Chains that exist are unaffected, and joining one isn't creating it.
    expect((await create()).status).toBe(200);
    expect((await pull()).status).toBe(200);
  });
});
