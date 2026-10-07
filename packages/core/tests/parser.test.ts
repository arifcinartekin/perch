import { describe, expect, it } from 'vitest';
import { parseFeed, sniffIsFeed, FeedParseError } from '../src/parser';
import { fixture } from './fixtures';

describe('parseFeed — RSS 2.0', () => {
  const feed = parseFeed(
    fixture('rss2.xml'),
    'application/rss+xml',
    'https://example.com/blog/feed',
  );

  it('reads channel metadata', () => {
    expect(feed.format).toBe('rss');
    expect(feed.title).toBe('Example Blog');
    expect(feed.siteUrl).toBe('https://example.com/blog');
    expect(feed.iconUrl).toBe('https://example.com/logo.png');
    expect(feed.articles).toHaveLength(2);
  });

  it('parses the first item with author, dates, content and enclosure', () => {
    const first = feed.articles[0]!;
    expect(first.title).toBe('First post');
    expect(first.url).toBe('https://example.com/blog/first-post');
    expect(first.author).toBe('Ada Lovelace');
    expect(first.publishedAt).toBe(Date.parse('Wed, 03 Jan 2024 08:00:00 GMT'));
    expect(first.contentHtml).toContain('Full body text.');
    expect(first.summaryHtml).toContain('<em>summary</em>');
    expect(first.enclosures[0]).toEqual({
      url: 'https://example.com/media/ep1.mp3',
      type: 'audio/mpeg',
      length: 12345,
    });
  });

  it('falls back to now for an item with no date', () => {
    const second = feed.articles[1]!;
    const now = Date.now();
    expect(second.publishedAt).toBeGreaterThan(now - 5000);
    expect(second.publishedAt).toBeLessThanOrEqual(now + 1000);
  });
});

describe('parseFeed — Atom', () => {
  const feed = parseFeed(
    fixture('atom.xml'),
    'application/atom+xml',
    'https://atom.example.org/feed.xml',
  );

  it('reads feed metadata and resolves the alternate link', () => {
    expect(feed.format).toBe('atom');
    expect(feed.title).toBe('Atom Example');
    expect(feed.siteUrl).toBe('https://atom.example.org/');
    expect(feed.iconUrl).toBe('https://atom.example.org/icon.png');
    expect(feed.articles).toHaveLength(2);
  });

  it('resolves relative entry links against the site URL', () => {
    expect(feed.articles[0]!.url).toBe('https://atom.example.org/posts/hello');
  });

  it('decodes escaped HTML content and inherits the feed author', () => {
    const first = feed.articles[0]!;
    expect(first.contentHtml).toContain('<strong>content</strong>');
    expect(first.author).toBe('Grace Hopper');
    expect(first.publishedAt).toBe(Date.parse('2024-05-01T12:00:00Z'));
  });

  it('flattens xhtml content to text', () => {
    expect(feed.articles[1]!.contentHtml).toContain('XHTML body.');
  });
});

describe('parseFeed — JSON Feed', () => {
  const feed = parseFeed(
    fixture('jsonfeed.json'),
    'application/json',
    'https://json.example.net/feed.json',
  );

  it('reads metadata and items', () => {
    expect(feed.format).toBe('json');
    expect(feed.title).toBe('JSON Feed Example');
    expect(feed.siteUrl).toBe('https://json.example.net/');
    expect(feed.articles).toHaveLength(2);
  });

  it('handles content_html, attachments and a numeric id', () => {
    const first = feed.articles[0]!;
    expect(first.contentHtml).toContain('<b>HTML</b>');
    expect(first.guid).toBe('100');
    expect(first.enclosures[0]?.url).toBe('https://json.example.net/audio/100.mp3');
  });

  it('wraps content_text and tolerates a bad date', () => {
    const second = feed.articles[1]!;
    expect(second.contentHtml).toContain('Line one.');
    expect(second.contentHtml).toContain('<br>');
    expect(Number.isFinite(second.publishedAt)).toBe(true);
  });
});

describe('parseFeed — error handling', () => {
  it('throws a FeedParseError on malformed XML that is not a feed', () => {
    expect(() =>
      parseFeed('<html><body>Not found</body></html>', 'text/html', 'https://x.test'),
    ).toThrow(FeedParseError);
  });

  it('throws on empty input', () => {
    expect(() => parseFeed('   ', undefined, 'https://x.test')).toThrow(FeedParseError);
  });

  it('throws on JSON that is not a JSON Feed', () => {
    expect(() => parseFeed('{"hello":true}', 'application/json', 'https://x.test')).toThrow(
      FeedParseError,
    );
  });

  it('parses a feed even when the content-type is wrong', () => {
    const feed = parseFeed(fixture('rss2.xml'), 'text/html', 'https://example.com/feed');
    expect(feed.articles).toHaveLength(2);
  });
});

describe('sniffIsFeed', () => {
  it('accepts xml/rss/atom signatures', () => {
    expect(sniffIsFeed('<?xml version="1.0"?><rss>')).toBe(true);
    expect(sniffIsFeed('<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(sniffIsFeed('{"version":"https://jsonfeed.org/version/1.1"}')).toBe(true);
  });

  it('rejects HTML error pages', () => {
    expect(sniffIsFeed('<!doctype html><html><head><title>404</title>', 'text/html')).toBe(false);
  });
});
