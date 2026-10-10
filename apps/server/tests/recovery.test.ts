import { randomBytes } from 'node:crypto';
import { DEFAULT_KDF } from '@perch/core/auth';
import { solvePow } from '@perch/core/pow';
import { newRecoveryCode } from '@perch/core/recovery';
import { setup } from './helpers';

const newKey = () => randomBytes(32).toString('base64url');
const newSalt = () => randomBytes(16).toString('base64url');

describe('recovery codes', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });
  afterEach(() => t.close());

  const recover = (username: string, recoveryCode: string, authKey = newKey()) =>
    t.call('POST', '/auth/recover', {
      body: { username, recoveryCode, authKey, salt: newSalt(), kdf: DEFAULT_KDF },
    });

  it('set at sign-up, replace a forgotten password and sign out the old sessions', async () => {
    const code = newRecoveryCode();
    const ada = await t.register('ada', { recoveryCode: code });
    expect(ada.body.user.hasRecovery).toBe(true);
    expect((await t.call('GET', '/server')).body.recovery).toBe(true);

    expect((await recover('ada', newRecoveryCode())).body.error).toBe('recovery-invalid');
    const authKey = newKey();
    const res = await recover('ada', code.toLowerCase().replace(/-/g, ' '), authKey);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect((await t.call('GET', '/auth/me', { token: ada.token })).status).toBe(401);

    // The new password works for signing in.
    const login = await t.call('POST', '/auth/login', { body: { username: 'ada', authKey } });
    expect(login.status).toBe(200);
  });

  it('can be added or replaced with the password', async () => {
    const bob = await t.register('bob');
    expect(bob.body.user.hasRecovery).toBeUndefined();
    expect((await recover('bob', newRecoveryCode())).body.error).toBe('recovery-invalid');

    const code = newRecoveryCode();
    const wrong = await t.call('POST', '/auth/recovery', {
      token: bob.token,
      body: { authKey: newKey(), recoveryCode: code },
    });
    expect(wrong.status).toBe(401);
    const set = await t.call('POST', '/auth/recovery', {
      token: bob.token,
      body: { authKey: bob.authKey, recoveryCode: code },
    });
    expect(set.body.user.hasRecovery).toBe(true);
    expect((await recover('bob', code)).status).toBe(200);
  });

  it('limits guesses per account', async () => {
    await t.register('cy', { recoveryCode: newRecoveryCode() });
    for (let i = 0; i < 5; i++) await recover('cy', newRecoveryCode());
    expect((await recover('cy', newRecoveryCode())).status).toBe(429);
  });
});

describe('proof of work at sign-up', () => {
  it('is asked for when configured, once per challenge, but not of the first account', async () => {
    const t = setup({ signupPow: 8 });
    try {
      expect((await t.call('GET', '/server')).body.pow).toBe(8);
      expect((await t.register('owner')).status).toBe(200);

      expect((await t.register('ada')).body.error).toBe('pow-required');
      const { challenge, bits } = (await t.call('GET', '/auth/challenge')).body;
      const nonce = await solvePow(challenge, bits);
      expect((await t.register('ada', { pow: { challenge, nonce } })).status).toBe(200);
      expect((await t.register('bob', { pow: { challenge, nonce } })).body.error).toBe(
        'pow-invalid',
      );
      const forged = { challenge: challenge.replace(/.$/, 'x'), nonce };
      expect((await t.register('cy', { pow: forged })).body.error).toBe('pow-invalid');
    } finally {
      t.close();
    }
  });

  it("isn't there when not configured", async () => {
    const t = setup();
    expect((await t.call('GET', '/server')).body.pow).toBeUndefined();
    expect((await t.call('GET', '/auth/challenge')).status).toBe(404);
    t.close();
  });
});
