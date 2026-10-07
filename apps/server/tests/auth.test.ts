import { randomBytes } from 'node:crypto';
import { setup } from './helpers';

const key = () => randomBytes(32).toString('base64url');

describe('accounts', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({ signup: 'invite' });
  });
  afterEach(() => t.close());

  it('reports server info and needs setup until the first account exists', async () => {
    const before = await t.call('GET', '/server');
    expect(before.body).toMatchObject({
      software: 'perch-server',
      mode: 'personal',
      needsSetup: true,
    });
    await t.register('owner');
    expect((await t.call('GET', '/server')).body.needsSetup).toBe(false);
  });

  it('makes the first account admin and requires an invite after that', async () => {
    const owner = await t.register('Owner');
    expect(owner.status).toBe(200);
    expect(owner.body.user).toMatchObject({
      username: 'owner',
      displayName: 'Owner',
      role: 'admin',
    });

    const noInvite = await t.register('friend');
    expect(noInvite.status).toBe(403);
    expect(noInvite.body.error).toBe('invite-required');

    const { body } = await t.call('POST', '/admin/invites', { token: owner.token });
    const friend = await t.register('friend', { invite: body.code });
    expect(friend.status).toBe(200);
    expect(friend.body.user.role).toBe('user');

    // Invites are single-use.
    const again = await t.register('friend2', { invite: body.code });
    expect(again.body.error).toBe('invite-invalid');

    // Only admins can make invites.
    expect((await t.call('POST', '/admin/invites', { token: friend.token })).status).toBe(403);
  });

  it('rejects bad usernames and duplicates, including look-alikes', async () => {
    t = setup({ signup: 'open' });
    expect((await t.register('ab')).body.error).toBe('username-too-short');
    expect((await t.register('admin')).body.error).toBe('username-reserved');
    expect((await t.register('çınar')).status).toBe(200);
    // Cyrillic "с" + accentless spelling collapse to the same name.
    const clash = await t.register('сinar');
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('username-taken');
  });

  it('logs in with the auth key, never the wrong one', async () => {
    const owner = await t.register('owner');
    const ok = await t.call('POST', '/auth/login', {
      body: { username: 'OWNER', authKey: owner.authKey, deviceName: 'Phone' },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/perch_session=.*HttpOnly.*SameSite=Strict/i);

    const bad = await t.call('POST', '/auth/login', {
      body: { username: 'owner', authKey: key() },
    });
    expect(bad.status).toBe(401);
    const unknown = await t.call('POST', '/auth/login', {
      body: { username: 'ghost', authKey: key() },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(bad.body.error);

    const me = await t.call('GET', '/auth/me', { token: ok.body.token });
    expect(me.body.user.username).toBe('owner');
  });

  it('throttles repeated failures for a username', async () => {
    const owner = await t.register('owner');
    for (let i = 0; i < 10; i++) {
      await t.call('POST', '/auth/login', { body: { username: 'owner', authKey: key() } });
    }
    const locked = await t.call('POST', '/auth/login', {
      body: { username: 'owner', authKey: owner.authKey },
    });
    expect(locked.status).toBe(429);
  });

  it('prelogin returns the real salt, and a stable fake one for unknown names', async () => {
    const salt = randomBytes(16).toString('base64url');
    await t.register('owner', { salt });
    expect(
      (await t.call('POST', '/auth/prelogin', { body: { username: 'Owner' } })).body.salt,
    ).toBe(salt);
    const a = await t.call('POST', '/auth/prelogin', { body: { username: 'nobody' } });
    const b = await t.call('POST', '/auth/prelogin', { body: { username: 'nobody' } });
    expect(a.body.salt).toBe(b.body.salt);
    expect(a.body.salt).not.toBe(salt);
    expect(a.body.kdf.algorithm).toBe('argon2id');
  });

  it('lists and revokes devices; logout ends the session', async () => {
    const owner = await t.register('owner', { deviceName: 'Laptop' });
    const phone = await t.call('POST', '/auth/login', {
      body: { username: 'owner', authKey: owner.authKey, deviceName: 'Phone' },
    });
    const { body } = await t.call('GET', '/devices', { token: owner.token });
    expect(body.devices.map((d: any) => [d.name, d.current]).sort()).toEqual([
      ['Laptop', true],
      ['Phone', false],
    ]);

    const phoneId = body.devices.find((d: any) => d.name === 'Phone').id;
    expect((await t.call('DELETE', `/devices/${phoneId}`, { token: owner.token })).status).toBe(
      200,
    );
    expect((await t.call('GET', '/auth/me', { token: phone.body.token })).status).toBe(401);

    await t.call('POST', '/auth/logout', { token: owner.token });
    expect((await t.call('GET', '/auth/me', { token: owner.token })).status).toBe(401);
  });

  it('changing the password signs out the other devices', async () => {
    const owner = await t.register('owner');
    const other = await t.call('POST', '/auth/login', {
      body: { username: 'owner', authKey: owner.authKey },
    });
    const newKey = key();
    const res = await t.call('POST', '/auth/password', {
      token: owner.token,
      body: {
        authKey: owner.authKey,
        newAuthKey: newKey,
        salt: randomBytes(16).toString('base64url'),
        kdf: { algorithm: 'argon2id', memory: 65536, iterations: 3, parallelism: 1 },
      },
    });
    expect(res.status).toBe(200);
    expect((await t.call('GET', '/auth/me', { token: other.body.token })).status).toBe(401);
    expect((await t.call('GET', '/auth/me', { token: owner.token })).status).toBe(200);
    const login = await t.call('POST', '/auth/login', {
      body: { username: 'owner', authKey: newKey },
    });
    expect(login.status).toBe(200);
  });

  it('refuses signups when closed, except the very first', async () => {
    t = setup({ signup: 'closed' });
    expect((await t.register('owner')).status).toBe(200);
    expect((await t.register('second')).body.error).toBe('signup-closed');
  });
});
