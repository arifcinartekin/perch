import { describe, expect, it } from 'vitest';
import { buildBackup, buildOpml, isPerchBackup, parseOpml } from '@/lib/backup';
import { DEFAULT_SETTINGS, UNCATEGORIZED_ID, type Category, type Feed } from '@/lib/types';

const categories: Category[] = [
  { id: 'tech', name: 'Tech', order: 10 },
  { id: UNCATEGORIZED_ID, name: 'Uncategorized', order: 1000 },
];

const feeds: Feed[] = [
  {
    id: 'f1',
    url: 'https://a.example/feed.xml',
    title: 'Site A',
    siteUrl: 'https://a.example',
    categoryId: 'tech',
    addedAt: 1,
  },
  {
    id: 'f2',
    url: 'https://b.example/rss',
    title: 'Site B',
    customTitle: 'B (renamed)',
    categoryId: UNCATEGORIZED_ID,
    addedAt: 2,
    etag: 'W/"x"',
    lastError: 'boom',
  },
];

describe('OPML', () => {
  it('builds OPML with category folders and feed outlines', () => {
    const opml = buildOpml(feeds, categories);
    expect(opml).toContain('<opml version="2.0">');
    expect(opml).toContain('<outline text="Tech" title="Tech">');
    expect(opml).toContain('xmlUrl="https://a.example/feed.xml"');
    expect(opml).toContain('htmlUrl="https://a.example"');
    // custom title is used as the outline text
    expect(opml).toContain('text="B (renamed)"');
  });

  it('round-trips through parseOpml', () => {
    const parsed = parseOpml(buildOpml(feeds, categories));
    expect(parsed.categories).toContain('Tech');
    expect(parsed.feeds).toHaveLength(2);
    const a = parsed.feeds.find((f) => f.url === 'https://a.example/feed.xml');
    expect(a?.categoryName).toBe('Tech');
    expect(a?.siteUrl).toBe('https://a.example');
  });

  it('parses a foreign OPML with nested folders', () => {
    const src = `<?xml version="1.0"?><opml version="1.0"><body>
      <outline title="News">
        <outline type="rss" text="Ars" xmlUrl="https://arstechnica.com/feed/" htmlUrl="https://arstechnica.com"/>
      </outline>
      <outline type="rss" text="Loose" xmlUrl="https://loose.example/rss"/>
    </body></opml>`;
    const parsed = parseOpml(src);
    expect(parsed.categories).toEqual(['News']);
    expect(parsed.feeds.map((f) => f.url).sort()).toEqual([
      'https://arstechnica.com/feed/',
      'https://loose.example/rss',
    ]);
    expect(parsed.feeds.find((f) => f.url.includes('ars'))?.categoryName).toBe('News');
    expect(parsed.feeds.find((f) => f.url.includes('loose'))?.categoryName).toBeUndefined();
  });

  it('de-duplicates repeated feed URLs', () => {
    const src = `<opml><body>
      <outline type="rss" xmlUrl="https://x.example/feed"/>
      <outline type="rss" xmlUrl="https://x.example/feed"/>
    </body></opml>`;
    expect(parseOpml(src).feeds).toHaveLength(1);
  });
});

describe('JSON backup', () => {
  it('omits the PIN and volatile per-fetch fields', () => {
    const backup = buildBackup(
      { ...DEFAULT_SETTINGS, pinHash: 'secret', pinSalt: 'salty' },
      feeds,
      categories,
    );
    expect(backup).toMatchObject({ app: 'perch', version: 1 });
    expect('pinHash' in backup.settings).toBe(false);
    expect('pinSalt' in backup.settings).toBe(false);
    const f2 = backup.feeds.find((f) => f.id === 'f2')!;
    expect('etag' in f2).toBe(false);
    expect('lastError' in f2).toBe(false);
    expect(f2.customTitle).toBe('B (renamed)');
  });

  it('isPerchBackup validates shape', () => {
    expect(isPerchBackup(buildBackup(DEFAULT_SETTINGS, feeds, categories))).toBe(true);
    expect(isPerchBackup({ app: 'other', feeds: [], categories: [] })).toBe(false);
    expect(isPerchBackup('nope')).toBe(false);
  });
});
