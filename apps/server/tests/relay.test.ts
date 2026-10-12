import { count as sqlCount } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { createApp, createContext } from '../src/app';
import { testConfig } from '../src/config';
import { setup } from './helpers';

describe('relay mode', () => {
  it('answers only the chain API, and says what it is', async () => {
    const t = setup({ mode: 'relay', chain: true, signup: 'closed' });
    try {
      const info = await t.call('GET', '/server');
      expect(info.body).toMatchObject({
        mode: 'relay',
        chain: true,
        signup: 'closed',
        needsSetup: false,
      });
      expect(info.body.recovery).toBeUndefined();
      const token = 'a'.repeat(43);
      const created = await t.app.request('/api/v1/chain', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(created.status).toBeLessThan(300);
      for (const [method, path] of [
        ['POST', '/auth/register'],
        ['POST', '/auth/login'],
        ['GET', '/shares'],
        ['GET', '/proxy?url=https://example.com'],
        ['GET', '/reader/library'],
      ] as const) {
        expect(
          (await t.call(method, path, { body: method === 'POST' ? {} : undefined })).status,
        ).toBe(404);
      }
      expect((await t.app.request('/shared/anything')).status).toBe(404);
    } finally {
      t.close();
    }
  });

  it('keeps accounts from before until told to delete them', async () => {
    const file = `/tmp/perch-relay-${process.pid}-${Date.now()}.db`;
    // An account made in hub mode, on disk.
    const before = createContext(testConfig({ mode: 'hub', databasePath: file }));
    const app = createApp(before);
    await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'leftover',
        authKey: 'k'.repeat(43),
        salt: 'AAECAwQFBgcICQoLDA0ODw',
        kdf: { algorithm: 'argon2id', memory: 65536, iterations: 3, parallelism: 1 },
      }),
    });
    before.close();
    const count = (c: ReturnType<typeof createContext>) =>
      c.db.select({ n: sqlCount() }).from(users).get()!.n;
    const kept = createContext(testConfig({ mode: 'relay', databasePath: file }));
    expect(count(kept)).toBe(1);
    kept.close();
    const purged = createContext(
      testConfig({ mode: 'relay', databasePath: file, purgeAccounts: true }),
    );
    expect(count(purged)).toBe(0);
    purged.close();
  });
});
