import { displayTitle } from './feeds';
import { asArray, attr, parseXml, text } from './parser/xml';
import { UNCATEGORIZED_ID, type Category, type Feed } from './types';

// OPML 2.0 import/export — the portable subscription list every reader speaks.

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildOpml(feeds: Feed[], categories: Category[]): string {
  const byCat = new Map<string, Feed[]>();
  for (const f of feeds) {
    const key = f.categoryId || UNCATEGORIZED_ID;
    let arr = byCat.get(key);
    if (!arr) byCat.set(key, (arr = []));
    arr.push(f);
  }

  const feedOutline = (f: Feed) => {
    const title = xmlEscape(displayTitle(f));
    const parts = [
      `text="${title}"`,
      `title="${title}"`,
      `type="rss"`,
      `xmlUrl="${xmlEscape(f.url)}"`,
    ];
    if (f.siteUrl) parts.push(`htmlUrl="${xmlEscape(f.siteUrl)}"`);
    return `      <outline ${parts.join(' ')}/>`;
  };

  const body = [...categories]
    .sort((a, b) => a.order - b.order)
    .map((cat) => {
      const catFeeds = byCat.get(cat.id) ?? [];
      if (catFeeds.length === 0) return '';
      const name = xmlEscape(cat.name);
      return [
        `    <outline text="${name}" title="${name}">`,
        ...catFeeds.map(feedOutline),
        `    </outline>`,
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>Perch subscriptions</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    `  </head>`,
    `  <body>`,
    body,
    `  </body>`,
    `</opml>`,
    ``,
  ].join('\n');
}

export interface ParsedOpml {
  categories: string[];
  feeds: { url: string; title?: string; siteUrl?: string; categoryName?: string }[];
}

export function parseOpml(source: string): ParsedOpml {
  const doc = parseXml(source);
  const opml = (doc.opml ?? {}) as Record<string, unknown>;
  const body = (opml.body ?? {}) as Record<string, unknown>;

  const categories = new Set<string>();
  const feeds: ParsedOpml['feeds'] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, categoryName?: string) => {
    for (const outline of asArray(node)) {
      const xmlUrl = attr(outline, 'xmlUrl') ?? attr(outline, 'xmlurl');
      const label = attr(outline, 'title') ?? attr(outline, 'text') ?? text(outline) ?? undefined;

      if (xmlUrl) {
        const url = xmlUrl.trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          feeds.push({
            url,
            title: label,
            siteUrl: attr(outline, 'htmlUrl') ?? attr(outline, 'htmlurl'),
            categoryName,
          });
        }
      } else {
        // A folder. One level of nesting maps to a Perch category.
        const name = label?.trim();
        if (name) categories.add(name);
        walk((outline as Record<string, unknown>).outline, name ?? categoryName);
      }
    }
  };

  walk(body.outline);
  return { categories: [...categories], feeds };
}
