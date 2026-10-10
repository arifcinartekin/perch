import { randomBytes } from 'node:crypto';
import { DEFAULT_KDF } from '@perch/core/auth';
import { loadConfig } from '../src/config';
import { setup } from './helpers';

const key = () => randomBytes(32).toString('base64url');
const salt = () => randomBytes(16).toString('base64url');

describe('email signup', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({ signup: 'email', publicUrl: 'https://app.perch.test' }, { email: true });
  });
  afterEach(() => t.close());

  const askCode = (email: string, purpose = 'signup', token?: string) =>
    t.call('POST', '/auth/email/code', { body: { email, purpose }, token });

  it('says the server sends email', async () => {
    expect((await t.call('GET', '/server')).body).toMatchObject({ signup: 'email', email: true });
  });

  it('signs up with an emailed code, which works once', async () => {
    expect((await askCode('Ada@Example.com')).body).toEqual({ ok: true });
    const mail = t.mailer!.sent[0]!;
    expect(mail.to).toBe('ada@example.com');
    expect(mail.text).toContain('app.perch.test');
    const code = t.mailer!.codeFor('ada@example.com')!;

    const ada = await t.register('ada', { email: 'ada@example.com', emailCode: code });
    expect(ada.status).toBe(200);
    expect(ada.body.user).toMatchObject({ username: 'ada', hasEmail: true });
    expect((await t.call('GET', '/auth/me', { token: ada.token })).body.user.hasEmail).toBe(true);

    const again = await t.register('ada2', { email: 'ada@example.com', emailCode: code });
    expect(again.body.error).toBe('email-code-invalid');
  });

  it('requires the code, and rejects a wrong one', async () => {
    expect((await t.register('ada')).body.error).toBe('email-required');
    await askCode('ada@example.com');
    const code = t.mailer!.codeFor('ada@example.com')!;
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await t.register('ada', { email: 'ada@example.com', emailCode: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('email-code-invalid');
    // A bad attempt doesn't burn the real code.
    expect((await t.register('ada', { email: 'ada@example.com', emailCode: code })).status).toBe(
      200,
    );
  });

  it('keeps the code when the username is taken', async () => {
    await askCode('a@example.com');
    await t.register('ada', {
      email: 'a@example.com',
      emailCode: t.mailer!.codeFor('a@example.com'),
    });
    await askCode('b@example.com');
    const code = t.mailer!.codeFor('b@example.com')!;
    expect((await t.register('ada', { email: 'b@example.com', emailCode: code })).body.error).toBe(
      'username-taken',
    );
    expect((await t.register('bob', { email: 'b@example.com', emailCode: code })).status).toBe(200);
  });

  it('gives up on a code after five wrong guesses', async () => {
    await askCode('ada@example.com');
    const code = t.mailer!.codeFor('ada@example.com')!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await t.register('ada', { email: 'ada@example.com', emailCode: wrong });
    }
    expect(
      (await t.register('ada', { email: 'ada@example.com', emailCode: code })).body.error,
    ).toBe('email-code-invalid');
  });

  it("doesn't reveal whether an address has an account", async () => {
    await askCode('ada@example.com');
    await t.register('ada', {
      email: 'ada@example.com',
      emailCode: t.mailer!.codeFor('ada@example.com'),
    });
    const res = await askCode('ada@example.com');
    expect(res.body).toEqual({ ok: true });
    const notice = t.mailer!.sent.at(-1)!;
    expect(notice.subject).toMatch(/already have/);
    expect(notice.text).not.toMatch(/\b\d{6}\b/);
  });

  it('writes the email in Turkish when asked', async () => {
    await t.call('POST', '/auth/email/code', {
      body: { email: 'ada@example.com', purpose: 'signup', lang: 'tr-TR' },
    });
    expect(t.mailer!.sent[0]!.subject).toMatch(/kayıt kodun/);
  });

  it('limits codes per address', async () => {
    for (let i = 0; i < 3; i++) expect((await askCode('ada@example.com')).status).toBe(200);
    expect((await askCode('ada@example.com')).status).toBe(429);
    expect(t.mailer!.sent).toHaveLength(3);
  });

  it('rejects addresses that are not addresses', async () => {
    expect((await askCode('not-an-email')).body.error).toBe('email-invalid');
  });

  it('resets a password with a code and signs out every device', async () => {
    await askCode('ada@example.com');
    const ada = await t.register('ada', {
      email: 'ada@example.com',
      emailCode: t.mailer!.codeFor('ada@example.com'),
    });

    // No account, no mail.
    await askCode('ghost@example.com', 'reset');
    expect(t.mailer!.sent.filter((m) => m.to === 'ghost@example.com')).toHaveLength(0);

    await askCode('ada@example.com', 'reset');
    const code = t.mailer!.codeFor('ada@example.com')!;
    const newKey = key();
    const reset = await t.call('POST', '/auth/reset', {
      body: { email: 'ada@example.com', code, authKey: newKey, salt: salt(), kdf: DEFAULT_KDF },
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user.username).toBe('ada');

    expect((await t.call('GET', '/auth/me', { token: ada.token })).status).toBe(401);
    const login = await t.call('POST', '/auth/login', {
      body: { username: 'ada', authKey: newKey },
    });
    expect(login.status).toBe(200);
    const old = await t.call('POST', '/auth/login', {
      body: { username: 'ada', authKey: ada.authKey },
    });
    expect(old.status).toBe(401);
  });

  it('adds an address to an account made before email signup', async () => {
    const plain = setup({ signup: 'open' }, { email: true });
    try {
      const owner = await plain.register('owner');
      // Signup codes are only for email signup.
      const signup = await plain.call('POST', '/auth/email/code', {
        body: { email: 'o@example.com', purpose: 'signup' },
      });
      expect(signup.body.error).toBe('signup-closed');

      const anon = await plain.call('POST', '/auth/email/code', {
        body: { email: 'o@example.com', purpose: 'change' },
      });
      expect(anon.status).toBe(401);

      await plain.call('POST', '/auth/email/code', {
        body: { email: 'o@example.com', purpose: 'change' },
        token: owner.token,
      });
      const res = await plain.call('POST', '/auth/email', {
        body: { email: 'o@example.com', code: plain.mailer!.codeFor('o@example.com') },
        token: owner.token,
      });
      expect(res.body.user.hasEmail).toBe(true);

      // Another account can't take it.
      const friend = await plain.register('friend');
      await plain.call('POST', '/auth/email/code', {
        body: { email: 'o@example.com', purpose: 'change' },
        token: friend.token,
      });
      expect(plain.mailer!.sent.at(-1)!.subject).toMatch(/already in use/);
    } finally {
      plain.close();
    }
  });

  it('ignores an unconfirmed address under other signup policies', async () => {
    const open = setup({ signup: 'open' }, { email: true });
    try {
      const res = await open.register('ada', { email: 'ada@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.user.hasEmail).toBeUndefined();
    } finally {
      open.close();
    }
  });
});

describe('email config', () => {
  it('needs a provider for email signup and a key for Resend', () => {
    expect(() => loadConfig({ PERCH_SIGNUP: 'email' })).toThrow(/PERCH_EMAIL/);
    expect(() => loadConfig({ PERCH_EMAIL: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ PERCH_EMAIL: 'resend', RESEND_API_KEY: 're_x' })).toThrow(
      /PERCH_EMAIL_FROM/,
    );
    const config = loadConfig({
      PERCH_SIGNUP: 'email',
      PERCH_EMAIL: 'resend',
      RESEND_API_KEY: 're_x',
      PERCH_EMAIL_FROM: 'Perch <noreply@mail.perch.ws>',
    });
    expect(config.email).toMatchObject({
      provider: 'resend',
      from: 'Perch <noreply@mail.perch.ws>',
    });
  });

  it('reports no email when the server has none', async () => {
    const t = setup();
    try {
      expect((await t.call('GET', '/server')).body.email).toBe(false);
      const res = await t.call('POST', '/auth/email/code', {
        body: { email: 'a@example.com', purpose: 'reset' },
      });
      expect(res.body.error).toBe('email-unavailable');
    } finally {
      t.close();
    }
  });

  it('keeps no address on disk, only a hash that finds the account', async () => {
    const t = setup({ signup: 'email' }, { email: true });
    const askCode = (email: string, purpose = 'signup') =>
      t.call('POST', '/auth/email/code', { body: { email, purpose } });
    await askCode('ada@example.com');
    await t.register('ada', {
      email: 'ada@example.com',
      emailCode: t.mailer!.codeFor('ada@example.com'),
    });
    const sqlite = (t.ctx.db as unknown as { $client: import('better-sqlite3').Database }).$client;
    const rows = JSON.stringify([
      sqlite.prepare('select * from users').all(),
      sqlite.prepare('select * from email_codes').all(),
    ]);
    expect(rows).not.toContain('ada@example');

    // Reset still finds the account from the address someone types.
    await askCode('ada@example.com', 'reset');
    expect(t.mailer!.sent.at(-1)!.to).toBe('ada@example.com');
    expect(t.mailer!.codeFor('ada@example.com')).toMatch(/^\d{6}$/);
    t.close();
  });
});

describe('servers that stored addresses before', () => {
  it('replace them with hashes on start, and reset still works', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'perch-email-'));
    const databasePath = join(dir, 'perch.db');
    const config = { databasePath, publicUrl: 'https://app.perch.test', signup: 'email' as const };
    try {
      const first = setup(config, { email: true });
      const ada = await first.register('ada', {
        email: 'ada@example.com',
        emailCode: await (async () => {
          await first.call('POST', '/auth/email/code', {
            body: { email: 'ada@example.com', purpose: 'signup' },
          });
          return first.mailer!.codeFor('ada@example.com');
        })(),
      });
      expect(ada.status).toBe(200);
      // As an older server would have left it.
      const sqlite = (first.ctx.db as unknown as { $client: import('better-sqlite3').Database })
        .$client;
      sqlite.prepare("update users set email = 'ada@example.com'").run();
      first.close();

      const again = setup(config, { email: true });
      try {
        expect(readFileSync(databasePath).includes('ada@example.com')).toBe(false);
        await again.call('POST', '/auth/email/code', {
          body: { email: 'ada@example.com', purpose: 'reset' },
        });
        expect(again.mailer!.codeFor('ada@example.com')).toMatch(/^\d{6}$/);
      } finally {
        again.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
