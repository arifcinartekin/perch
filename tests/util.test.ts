import { describe, expect, it } from 'vitest';
import { fnv1aHex, idFrom } from '@/lib/util/hash';
import {
  bareHost,
  isHttpUrl,
  normalizeFeedUrl,
  originOf,
  originPattern,
  resolveUrl,
} from '@/lib/util/url';

describe('hash', () => {
  it('is stable and 8 hex chars', () => {
    expect(fnv1aHex('hello')).toBe(fnv1aHex('hello'));
    expect(fnv1aHex('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex('hello')).not.toBe(fnv1aHex('world'));
  });

  it('idFrom joins parts and ignores nullish', () => {
    expect(idFrom('feed', 'https://x/y')).toBe(idFrom('feed', 'https://x/y'));
    expect(idFrom('a', undefined, 'b')).toBe(idFrom('a', null, 'b'));
  });
});

describe('normalizeFeedUrl', () => {
  it('lowercases host, drops hash and trailing slash and default port', () => {
    expect(normalizeFeedUrl('HTTPS://Example.COM:443/feed/#top')).toBe('https://example.com/feed');
  });
  it('keeps query strings', () => {
    expect(normalizeFeedUrl('https://example.com/?feed=rss2')).toBe(
      'https://example.com/?feed=rss2',
    );
  });
  it('leaves a bare root slash alone', () => {
    expect(normalizeFeedUrl('https://example.com/')).toBe('https://example.com/');
  });
});

describe('url helpers', () => {
  it('resolveUrl resolves relative against a base', () => {
    expect(resolveUrl('/a/b', 'https://x.test/c')).toBe('https://x.test/a/b');
    expect(resolveUrl('  ', 'https://x.test')).toBeUndefined();
    expect(resolveUrl('http://[bad', undefined)).toBeUndefined();
  });
  it('originOf / bareHost', () => {
    expect(originOf('https://sub.example.com/x?y')).toBe('https://sub.example.com');
    expect(bareHost('https://www.example.com/x')).toBe('example.com');
  });
  it('isHttpUrl only allows http(s)', () => {
    expect(isHttpUrl('https://x.test')).toBe(true);
    expect(isHttpUrl('ftp://x.test')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('originPattern', () => {
  it('builds an origin match pattern', () => {
    expect(originPattern('https://example.com/feed.xml')).toBe('https://example.com/*');
    expect(originPattern('not a url')).toBeNull();
  });
});
