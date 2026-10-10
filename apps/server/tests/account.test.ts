import { setup } from './helpers';

const ID = 'feed1:article1';

describe('deleting an account', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({ publicUrl: 'https://app.perch.test', signup: 'open' });
  });
  afterEach(() => t.close());

  it('needs the password, then removes the account, its sessions and its pages', async () => {
    await t.register('owner');
    const ada = await t.register('ada');
    await t.call('PUT', `/notes/${encodeURIComponent(ID)}`, {
      token: ada.token,
      body: { title: 'A', body: 'Hello' },
    });
    const share = await t.call('PUT', `/shares/${encodeURIComponent(ID)}`, { token: ada.token });
    const pagePath = new URL(share.body.url).pathname;
    expect((await t.app.request(pagePath)).status).toBe(200);

    const wrong = await t.call('POST', '/auth/delete', {
      token: ada.token,
      body: { authKey: 'A'.repeat(43) },
    });
    expect(wrong.status).toBe(401);

    const ok = await t.call('POST', '/auth/delete', {
      token: ada.token,
      body: { authKey: ada.authKey },
    });
    expect(ok.status).toBe(200);
    expect((await t.call('GET', '/auth/me', { token: ada.token })).status).toBe(401);
    expect((await t.app.request(pagePath)).status).toBe(404);
    // The name is free again.
    expect((await t.register('ada')).status).toBe(200);
  });

  it("won't leave a server with users but no admin", async () => {
    const owner = await t.register('owner');
    await t.register('ada');
    const res = await t.call('POST', '/auth/delete', {
      token: owner.token,
      body: { authKey: owner.authKey },
    });
    expect(res.body.error).toBe('last-admin');
  });
});

describe('policy links', () => {
  it('names the operator’s privacy policy and terms when set', async () => {
    const t = setup({
      privacyUrl: 'https://example.org/privacy',
      termsUrl: 'https://example.org/terms',
    });
    expect((await t.call('GET', '/server')).body.legal).toEqual({
      privacy: 'https://example.org/privacy',
      terms: 'https://example.org/terms',
    });
    const { token } = await t.register('owner');
    await t.call('PUT', `/notes/${encodeURIComponent(ID)}`, {
      token,
      body: { title: 'A', body: 'Hi' },
    });
    const share = await t.call('PUT', `/shares/${encodeURIComponent(ID)}`, { token });
    const html = await (await t.app.request(new URL(share.body.url).pathname)).text();
    expect(html).toContain('href="https://example.org/privacy"');
    t.close();
  });

  it('leaves them out when not', async () => {
    const t = setup();
    expect((await t.call('GET', '/server')).body.legal).toBeUndefined();
    t.close();
  });
});

describe('configuration', () => {
  it('ignores stray spaces around .env values', async () => {
    const { loadConfig } = await import('../src/config');
    const config = loadConfig({ PERCH_SIGNUP: 'open  ', PERCH_CHAIN: ' true ' });
    expect(config.signup).toBe('open');
    expect(config.chain).toBe(true);
  });
});
