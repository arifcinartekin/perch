import { deriveKeys, isValidKdf, newSalt, type KdfParams } from '../src/auth';
import { feedLinksFromHtml } from '../src/discovery/html';
import { normalizeUsername, usernameProblem } from '../src/username';

describe('normalizeUsername / usernameProblem', () => {
  it('lower-cases and folds look-alike letters', () => {
    expect(normalizeUsername('  Arif ')).toBe('arif');
    // Cyrillic "а" and "о" look identical to Latin ones.
    expect(normalizeUsername('pаrоla')).toBe('parola');
    expect(normalizeUsername('ＡＲＩＦ')).toBe('arif'); // full-width, via NFKC
    expect(normalizeUsername('Çınar_Işık')).toBe('cinar_isik');
  });

  it('enforces length, characters and reserved names', () => {
    expect(usernameProblem('ab')).toBe('too-short');
    expect(usernameProblem('a'.repeat(25))).toBe('too-long');
    expect(usernameProblem('ali veli')).toBe('invalid-characters');
    expect(usernameProblem('admin')).toBe('reserved');
    expect(usernameProblem('ad_min')).toBe('reserved');
    expect(usernameProblem('arif.cinar_42')).toBeNull();
  });
});

describe('feedLinksFromHtml', () => {
  it('finds alternate feed links and resolves them', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/s.css">
      <link rel="alternate" type="application/rss+xml" title="Posts &amp; news" href="/feed.xml">
      <link type='application/atom+xml' rel='alternate' href='https://cdn.example.com/atom'>
      <link rel="alternate" type="application/json" href="/not-a-feed.json">
      <link rel="feed" href="/everything">
      <link rel="alternate" hreflang="tr" href="/tr">
    </head><body></body></html>`;
    expect(feedLinksFromHtml(html, 'https://example.com/blog/post')).toEqual([
      { url: 'https://example.com/feed.xml', type: 'application/rss+xml', title: 'Posts & news' },
      { url: 'https://cdn.example.com/atom', type: 'application/atom+xml', title: undefined },
      { url: 'https://example.com/everything', type: 'feed', title: undefined },
    ]);
  });

  it('honours <base href>', () => {
    const html = `<base href="https://other.example/sub/"><link rel="alternate" type="application/rss+xml" href="rss">`;
    expect(feedLinksFromHtml(html, 'https://example.com/')[0]?.url).toBe(
      'https://other.example/sub/rss',
    );
  });
});

describe('deriveKeys', () => {
  const fast: KdfParams = {
    algorithm: 'argon2id',
    memory: 8 * 1024,
    iterations: 1,
    parallelism: 1,
  };

  it('is deterministic per password + salt and separates the two keys', async () => {
    const salt = newSalt();
    const a = await deriveKeys('correct horse', salt, fast);
    const b = await deriveKeys('correct horse', salt, fast);
    expect(a.authKey).toBe(b.authKey);
    expect(a.authKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.masterKey).toHaveLength(32);
    expect(Buffer.from(a.masterKey).toString('base64url')).not.toBe(a.authKey);

    expect((await deriveKeys('correct horse', newSalt(), fast)).authKey).not.toBe(a.authKey);
    expect((await deriveKeys('wrong horse', salt, fast)).authKey).not.toBe(a.authKey);
  });

  it('validates KDF parameters', () => {
    expect(isValidKdf(fast)).toBe(true);
    expect(isValidKdf({ ...fast, memory: 1024 })).toBe(false);
    expect(isValidKdf({ ...fast, algorithm: 'pbkdf2' })).toBe(false);
    expect(isValidKdf(null)).toBe(false);
  });
});
