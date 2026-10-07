import { nextFetchTime } from '../src/feeds/fetcher';
import { createSafeFetch, detectCharset, isPrivateAddress } from '../src/lib/safe-fetch';
import { feedServer } from './helpers';

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true], // cloud metadata
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:192.168.0.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['2606:4700:4700::1111', false],
    ['::ffff:8.8.8.8', false],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('createSafeFetch', () => {
  it('refuses loopback by default, by literal IP and by hostname', async () => {
    const srv = await feedServer({ '/feed': (_q, r) => r.end('ok') });
    try {
      const fetch = createSafeFetch({ allowPrivate: false, allowHosts: [] });
      await expect(fetch(srv.url('/feed'))).rejects.toThrow(/private or reserved/);
      const port = new URL(srv.url('/')).port;
      await expect(fetch(`http://localhost:${port}/feed`)).rejects.toThrow();
      expect(srv.hits).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('allows listed hosts and follows redirects with a final url', async () => {
    const srv = await feedServer({
      '/old': (_q, r) => r.writeHead(301, { location: '/new' }).end(),
      '/new': (_q, r) => r.end('moved'),
    });
    try {
      const fetch = createSafeFetch({ allowPrivate: false, allowHosts: ['127.0.0.1'] });
      const res = await fetch(srv.url('/old'));
      expect(await res.text()).toBe('moved');
      expect(res.url).toBe(srv.url('/new'));
    } finally {
      await srv.close();
    }
  });

  it('re-checks every redirect hop', async () => {
    // An allowed host redirecting to a blocked one must fail.
    const srv = await feedServer({
      '/hop': (_q, r) => r.writeHead(302, { location: 'http://169.254.169.254/latest' }).end(),
    });
    try {
      const fetch = createSafeFetch({ allowPrivate: false, allowHosts: ['127.0.0.1'] });
      await expect(fetch(srv.url('/hop'))).rejects.toThrow(/169\.254\.169\.254/);
    } finally {
      await srv.close();
    }
  });

  it('refuses non-http protocols', async () => {
    const fetch = createSafeFetch({ allowPrivate: true, allowHosts: [] });
    await expect(fetch('file:///etc/passwd')).rejects.toThrow(/protocol/);
  });
});

describe('detectCharset', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it('prefers the header, then the XML declaration', () => {
    expect(detectCharset('text/xml; charset=windows-1254', bytes('<?xml encoding="utf-8"?>'))).toBe(
      'windows-1254',
    );
    expect(detectCharset('text/xml', bytes('<?xml version="1.0" encoding="ISO-8859-9"?>'))).toBe(
      'ISO-8859-9',
    );
    expect(detectCharset(null, bytes('<rss>'))).toBe('utf-8');
  });
});

describe('nextFetchTime', () => {
  const min = 60_000;
  it('schedules the interval ±10% when healthy', () => {
    expect(nextFetchTime(0, 30, 0, undefined, () => 0)).toBe(27 * min);
    expect(nextFetchTime(0, 30, 0, undefined, () => 1)).toBe(33 * min);
  });
  it('doubles per failure, capped at a day, honouring Retry-After', () => {
    expect(nextFetchTime(0, 30, 1)).toBe(30 * min);
    expect(nextFetchTime(0, 30, 3)).toBe(120 * min);
    expect(nextFetchTime(0, 30, 50)).toBe(24 * 60 * min);
    expect(nextFetchTime(0, 30, 1, 7200)).toBe(120 * min);
  });
});
