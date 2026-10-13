import { describe, expect, it } from 'vitest';
import { feedIdFor } from '../src/feeds';
import { parseFeed } from '../src/parser';
import { excerptOf, toArticle } from '../src/parser/normalize';
import type { ParsedArticle } from '../src/types';

const base: ParsedArticle = {
  title: 'Post',
  url: 'https://example.com/post',
  guid: 'guid-1',
  publishedAt: 1_700_000_000_000,
  enclosures: [],
  summaryHtml: '<p>Hello <b>world</b> &amp; friends</p>',
};

describe('toArticle', () => {
  it('produces a stable id from feedId + guid', () => {
    const a = toArticle(base, 'feed-x');
    const b = toArticle({ ...base, title: 'changed later' }, 'feed-x');
    expect(a.id).toBe(b.id);
  });

  it('changes id when the feed changes', () => {
    expect(toArticle(base, 'feed-x').id).not.toBe(toArticle(base, 'feed-y').id);
  });

  it('falls back to url then title+date for identity', () => {
    const noGuid = toArticle({ ...base, guid: undefined }, 'f');
    const sameByUrl = toArticle({ ...base, guid: undefined, title: 'different' }, 'f');
    expect(noGuid.id).toBe(sameByUrl.id);
  });

  it('keys an item without guid or link on its title and date, like the apps', () => {
    const feedId = feedIdFor('https://ex.com/feed');
    const item = { ...base, guid: undefined, url: undefined, title: 'One' };
    // The same values as FeedIdsTest.kt and LocalLibraryTests.swift.
    expect(toArticle({ ...item, publishedAt: 1_767_225_600_000 }, feedId).id).toBe('483ee61f');
    expect(toArticle({ ...item, publishedAt: 5, undated: true }, feedId).id).toBe('ddec0483');
  });

  it('gives an undated item the same id on every fetch', () => {
    const xml = `<rss version="2.0"><channel><title>T</title>
      <item><title>No date, no link</title></item></channel></rss>`;
    const first = parseFeed(xml, 'application/rss+xml', 'https://ex.com/feed').articles[0]!;
    expect(first.undated).toBe(true);
    const later = { ...first, publishedAt: first.publishedAt + 60_000 };
    expect(toArticle(later, 'f').id).toBe(toArticle(first, 'f').id);
  });

  it('initialises read/starred to 0', () => {
    const a = toArticle(base, 'f');
    expect(a.read).toBe(0);
    expect(a.starred).toBe(0);
  });
});

describe('excerptOf', () => {
  it('strips tags and decodes entities', () => {
    expect(excerptOf(base)).toBe('Hello world & friends');
  });

  it('truncates with an ellipsis', () => {
    const long = { summaryHtml: `<p>${'a'.repeat(500)}</p>` };
    const out = excerptOf(long, 100);
    expect(out.length).toBe(100);
    expect(out.endsWith('…')).toBe(true);
  });
});
