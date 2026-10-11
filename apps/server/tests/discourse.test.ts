import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers';

const secret = 'a-shared-secret-for-tests';
const forum = 'https://community.perch.test';
const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');
const request = (returnUrl = `${forum}/session/sso_login`, nonce = 'n0nce') => {
  const sso = Buffer.from(
    new URLSearchParams({ nonce, return_sso_url: returnUrl }).toString(),
  ).toString('base64');
  return { sso, sig: sign(sso) };
};

describe('DiscourseConnect', () => {
  it('asks a signed-out visitor to sign in first, then come back', async () => {
    const t = setup({ mode: 'hub', discourse: { url: forum, secret } });
    try {
      const { sso, sig } = request();
      const res = await t.app.request(`/discourse/sso?sso=${encodeURIComponent(sso)}&sig=${sig}`);
      expect(res.status).toBe(302);
      const next = new URL(res.headers.get('location')!, 'https://x').searchParams.get('next');
      expect(next).toBe(`/discourse/sso?sso=${encodeURIComponent(sso)}&sig=${sig}`);
    } finally {
      t.close();
    }
  });

  it('confirms, then sends back only the username and id, signed', async () => {
    const t = setup({ mode: 'hub', discourse: { url: forum, secret } });
    try {
      const { token } = await t.register('heron_reader');
      const cookie = `perch_session=${token}`;
      const { sso, sig } = request();
      const ask = await t.app.request(`/discourse/sso?sso=${encodeURIComponent(sso)}&sig=${sig}`, {
        headers: { cookie },
      });
      expect(ask.status).toBe(200);
      expect(ask.headers.get('content-security-policy')).toContain(`form-action 'self' ${forum}`);
      expect(await ask.text()).toContain('@heron_reader');

      const res = await t.app.request('/discourse/sso', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ sso, sig }).toString(),
      });
      expect(res.status).toBe(302);
      const back = new URL(res.headers.get('location')!);
      expect(back.origin).toBe(forum);
      const payload = back.searchParams.get('sso')!;
      expect(back.searchParams.get('sig')).toBe(sign(payload));
      const fields = Object.fromEntries(
        new URLSearchParams(Buffer.from(payload, 'base64').toString()),
      );
      expect(fields.nonce).toBe('n0nce');
      expect(fields.username).toBe('heron_reader');
      expect(fields.email).toMatch(/^[\w-]+@users\.perch\.invalid$/);
      expect(fields.require_activation).toBe('false');
      expect(Object.keys(fields).sort()).toEqual([
        'admin',
        'email',
        'external_id',
        'name',
        'nonce',
        'require_activation',
        'suppress_welcome_message',
        'username',
      ]);
    } finally {
      t.close();
    }
  });

  it('refuses a bad signature, another return address, and a forged POST', async () => {
    const t = setup({ mode: 'hub', discourse: { url: forum, secret } });
    try {
      const { token } = await t.register('owl_reader');
      const cookie = `perch_session=${token}`;
      const good = request();
      const forged = await t.app.request(
        `/discourse/sso?sso=${encodeURIComponent(good.sso)}&sig=${'0'.repeat(64)}`,
        { headers: { cookie } },
      );
      expect(forged.status).toBe(400);
      const elsewhere = request('https://evil.example/session/sso_login');
      const away = await t.app.request(
        `/discourse/sso?sso=${encodeURIComponent(elsewhere.sso)}&sig=${elsewhere.sig}`,
        { headers: { cookie } },
      );
      expect(away.status).toBe(400);
      const signedOut = await t.app.request('/discourse/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(good).toString(),
      });
      expect(signedOut.status).toBe(400);
    } finally {
      t.close();
    }
  });

  it("isn't there unless configured", async () => {
    const t = setup({ mode: 'hub' });
    try {
      const { sso, sig } = request();
      expect((await t.app.request(`/discourse/sso?sso=${sso}&sig=${sig}`)).status).not.toBe(302);
    } finally {
      t.close();
    }
  });
});
