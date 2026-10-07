import { describe, expect, it } from 'vitest';
import { buildCandidates, MAX_CANDIDATES } from '../src/discovery/candidates';

describe('buildCandidates', () => {
  it('returns same-origin well-known paths and stays under the cap', () => {
    const list = buildCandidates('https://example.com/blog/post-1');
    expect(list.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(list).toContain('https://example.com/feed');
    expect(list).toContain('https://example.com/rss.xml');
    // No cross-origin guesses without the flag.
    expect(list.every((u) => new URL(u).origin === 'https://example.com')).toBe(true);
  });

  it('adds a path-prefix guess when the page is nested', () => {
    const list = buildCandidates('https://example.com/blog/post-1');
    expect(list).toContain('https://example.com/blog/feed');
  });

  it('includes cross-origin subdomains only when asked', () => {
    const list = buildCandidates('https://www.example.com/', { includeCrossOrigin: true });
    expect(list.some((u) => u.startsWith('https://rss.example.com/'))).toBe(true);
    expect(list.some((u) => u.startsWith('https://feeds.example.com/'))).toBe(true);
  });

  it('returns nothing for non-http URLs', () => {
    expect(buildCandidates('chrome://extensions')).toEqual([]);
    expect(buildCandidates('about:blank')).toEqual([]);
  });

  it('de-duplicates', () => {
    const list = buildCandidates('https://example.com/');
    expect(new Set(list).size).toBe(list.length);
  });
});
