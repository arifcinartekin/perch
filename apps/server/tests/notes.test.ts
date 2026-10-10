import { Hlc, type SyncRecord } from '@perch/core/sync';
import { setup } from './helpers';

const ID = 'feed1:article1';
const path = `/notes/${encodeURIComponent(ID)}`;
const sharePath = `/shares/${encodeURIComponent(ID)}`;

describe('notes and shared pages', () => {
  let t: ReturnType<typeof setup>;
  let token: string;
  beforeEach(async () => {
    t = setup({ publicUrl: 'https://app.perch.test' });
    token = (await t.register('owner')).token;
  });
  afterEach(() => t.close());

  const save = (body: string, tok = token) =>
    t.call('PUT', path, {
      token: tok,
      body: { title: 'An article', url: 'https://blog.example/a', feedTitle: 'Blog', body },
    });
  const page = async (url: string, init?: RequestInit) => {
    const res = await t.app.request(new URL(url).pathname, init);
    return { status: res.status, headers: res.headers, html: await res.text() };
  };

  it('saves notes as records other devices pull', async () => {
    const saved = await save('First *thought*');
    expect(saved.status).toBe(200);
    expect(saved.body.note).toMatchObject({ id: ID, feedId: 'feed1', articleId: 'article1' });

    const list = await t.call('GET', '/notes', { token });
    expect(list.body.notes).toHaveLength(1);
    const changes = await t.call('GET', '/sync/changes?since=0', { token });
    expect(changes.body.records[0]).toMatchObject({ type: 'note', id: ID });

    await save('Edited');
    const again = await t.call('GET', '/notes', { token });
    expect(again.body.notes[0].body).toBe('Edited');
    expect(again.body.notes[0].createdAt).toBe(saved.body.note.createdAt);

    await t.call('DELETE', path, { token });
    expect((await t.call('GET', '/notes', { token })).body.notes).toEqual([]);
  });

  it('accepts pushed notes and refuses malformed ones', async () => {
    const hlc = new Hlc('phone');
    const note = (data: Record<string, unknown>, id = ID): SyncRecord =>
      ({ type: 'note', id, hlc: hlc.now(), data }) as unknown as SyncRecord;
    const good = {
      feedId: 'feed1',
      articleId: 'article1',
      title: 'T',
      body: 'Hi',
      createdAt: 1,
      updatedAt: 2,
    };
    const res = await t.call('POST', '/sync/push', {
      token,
      body: {
        records: [
          note(good),
          note({ ...good, body: 'x'.repeat(10_001) }, 'feed1:article2'),
          note(good, 'feed1:other'),
        ],
      },
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'ok',
      'invalid',
      'invalid',
    ]);
  });

  it('shares a note as a public page that follows the note', async () => {
    expect((await t.call('PUT', sharePath, { token })).body.error).toBe('note-not-found');
    await save('A **bold** idea');

    const shared = await t.call('PUT', sharePath, { token });
    expect(shared.status).toBe(200);
    expect(shared.body.url).toMatch(/^https:\/\/app\.perch\.test\/shared\/[\w-]+$/);
    // The link is on the note, so every device sees it is shared.
    const notes = (await t.call('GET', '/notes', { token })).body.notes;
    expect(notes[0].sharedUrl).toBe(shared.body.url);
    // Sharing again keeps the same address.
    expect((await t.call('PUT', sharePath, { token })).body.url).toBe(shared.body.url);

    let p = await page(shared.body.url);
    expect(p.status).toBe(200);
    expect(p.html).toContain('<strong>bold</strong>');
    expect(p.html).toContain('@owner');
    expect(p.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(p.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    // Editing the note updates the page; the link survives the edit.
    await save('Changed my mind');
    p = await page(shared.body.url);
    expect(p.html).toContain('Changed my mind');
    expect((await t.call('GET', '/notes', { token })).body.notes[0].sharedUrl).toBe(
      shared.body.url,
    );

    // Unsharing takes the page down and clears the link.
    await t.call('DELETE', sharePath, { token });
    expect((await page(shared.body.url)).status).toBe(404);
    expect((await t.call('GET', '/notes', { token })).body.notes[0].sharedUrl).toBeUndefined();
  });

  it('takes the page down when the note is deleted', async () => {
    await save('Soon gone');
    const { url } = (await t.call('PUT', sharePath, { token })).body;
    await t.call('DELETE', path, { token });
    expect((await page(url)).status).toBe(404);
  });

  it('never lets a note run script or load anything', async () => {
    await save(
      '<script>alert(1)</script> [x](javascript:alert(1)) ![img](https://tracker.example/p.gif) <img src=x onerror=alert(1)>',
    );
    const { url } = (await t.call('PUT', sharePath, { token })).body;
    const { html } = await page(url);
    const note = html.slice(html.indexOf('<div class="note">'));
    expect(note).not.toContain('<script');
    expect(note).not.toContain('<img');
    expect(note).not.toContain('href="javascript:');
    expect(note).toContain('&lt;script&gt;');
  });

  it("keeps other people's notes and shares to themselves", async () => {
    await save('Mine');
    const other = (await t.register('other')).token;
    expect((await t.call('GET', '/notes', { token: other })).body.notes).toEqual([]);
    expect((await t.call('PUT', sharePath, { token: other })).body.error).toBe('note-not-found');
  });

  it('takes reports, and an admin can hide the page', async () => {
    await save('Questionable');
    const { url, slug } = (await t.call('PUT', sharePath, { token })).body;
    const form = new URLSearchParams({ reason: 'spam', details: 'Ads', contact: 'r@example.com' });
    const sent = await page(`${url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(sent.status).toBe(200);
    expect(sent.html).toContain('Thanks for the report');

    const friend = (await t.register('friend')).token;
    expect((await t.call('GET', '/admin/reports', { token: friend })).status).toBe(403);

    const list = await t.call('GET', '/admin/reports', { token });
    expect(list.body.reports).toHaveLength(1);
    expect(list.body.reports[0]).toMatchObject({
      reason: 'spam',
      details: 'Ads',
      contact: 'r@example.com',
      share: { slug, author: 'owner', hidden: false },
    });

    const id = list.body.reports[0].id;
    expect(
      (await t.call('POST', `/admin/reports/${id}`, { token, body: { action: 'hide' } })).status,
    ).toBe(200);
    const hidden = await page(url);
    expect(hidden.status).toBe(410);
    expect(hidden.html).toContain('removed');
    expect((await t.call('GET', '/admin/reports', { token })).body.reports).toEqual([]);

    // Removed pages are listed, and can be put back up.
    const removed = await t.call('GET', '/admin/reports/hidden', { token });
    expect(removed.body.hidden).toHaveLength(1);
    const removedSlug = removed.body.hidden[0].slug;
    expect(
      (await t.call('POST', `/admin/reports/hidden/${removedSlug}/restore`, { token })).status,
    ).toBe(200);
    expect((await page(url)).status).toBe(200);
    expect((await t.call('GET', '/admin/reports/hidden', { token })).body.hidden).toEqual([]);
  });
});
