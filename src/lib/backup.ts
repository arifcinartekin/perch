import { parseXml, asArray, attr, text } from './parser/xml';
import { addCategory, getCategories, saveCategories } from './storage/categories';
import { addFeed, getFeeds, saveFeeds } from './storage/feeds';
import { getSettings, saveSettings } from './storage/settings';
import { hasHostPermission } from './permissions/host';
import { displayTitle } from './storage/feeds';
import { UNCATEGORIZED_ID, type Category, type Feed, type Settings } from './types';

// Import / export of the feed list. Everything is local, so a user can take a
// backup and move between machines. Two formats:
//   - OPML 2.0  — the portable standard, works with any other reader.
//   - Perch JSON — a full backup of feeds + categories + settings (never the PIN).

// ---------------------------------------------------------------------------
// OPML
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Perch JSON backup
// ---------------------------------------------------------------------------

export interface PerchBackup {
  app: 'perch';
  version: 1;
  exportedAt: number;
  settings: Omit<Settings, 'pinSalt' | 'pinHash'>;
  categories: Category[];
  feeds: Feed[];
}

export function buildBackup(
  settings: Settings,
  feeds: Feed[],
  categories: Category[],
): PerchBackup {
  const { pinSalt: _s, pinHash: _h, ...safeSettings } = settings;
  return {
    app: 'perch',
    version: 1,
    exportedAt: Date.now(),
    settings: safeSettings,
    categories,
    // Drop volatile per-fetch fields from the backup.
    feeds: feeds.map(({ etag: _e, lastModified: _m, lastError: _err, ...f }) => f),
  };
}

export function isPerchBackup(value: unknown): value is PerchBackup {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PerchBackup).app === 'perch' &&
    Array.isArray((value as PerchBackup).feeds) &&
    Array.isArray((value as PerchBackup).categories)
  );
}

// ---------------------------------------------------------------------------
// Apply to storage
// ---------------------------------------------------------------------------

export interface ImportResult {
  feedsAdded: number;
  feedsSkipped: number;
  categoriesAdded: number;
}

async function addFeedsFromList(
  list: { url: string; title?: string; siteUrl?: string; categoryName?: string }[],
  nameToId: Map<string, string>,
): Promise<{ added: number; skipped: number }> {
  const before = (await getFeeds()).length;
  for (const item of list) {
    const categoryId = item.categoryName
      ? (nameToId.get(item.categoryName.toLowerCase()) ?? UNCATEGORIZED_ID)
      : UNCATEGORIZED_ID;
    const granted = await hasHostPermission(item.url).catch(() => false);
    await addFeed({
      url: item.url,
      title: item.title,
      siteUrl: item.siteUrl,
      categoryId,
      needsPermission: !granted,
    });
  }
  const after = (await getFeeds()).length;
  return { added: after - before, skipped: list.length - (after - before) };
}

/** Merge an OPML file into the current subscriptions. */
export async function importOpml(source: string): Promise<ImportResult> {
  const parsed = parseOpml(source);

  const existing = await getCategories();
  const nameToId = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  let categoriesAdded = 0;
  for (const name of parsed.categories) {
    if (!nameToId.has(name.toLowerCase())) {
      const cat = await addCategory(name);
      nameToId.set(name.toLowerCase(), cat.id);
      categoriesAdded++;
    }
  }

  const { added, skipped } = await addFeedsFromList(parsed.feeds, nameToId);
  return { feedsAdded: added, feedsSkipped: skipped, categoriesAdded };
}

/**
 * Restore a Perch JSON backup. `mode: 'replace'` wipes the current feed list and
 * categories first; `mode: 'merge'` keeps what's there and adds the rest.
 */
export async function importBackup(
  source: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isPerchBackup(data)) throw new Error('That file is not a Perch backup.');

  if (mode === 'replace') {
    await saveFeeds([]);
    await saveCategories(data.categories);
  } else {
    const existing = await getCategories();
    const haveIds = new Set(existing.map((c) => c.id));
    const merged = [...existing, ...data.categories.filter((c) => !haveIds.has(c.id))];
    await saveCategories(merged);
  }

  const validCategory = new Set((await getCategories()).map((c) => c.id));

  const before = (await getFeeds()).length;
  for (const f of data.feeds) {
    const categoryId = validCategory.has(f.categoryId) ? f.categoryId : UNCATEGORIZED_ID;
    const granted = await hasHostPermission(f.url).catch(() => false);
    await addFeed({
      url: f.url,
      title: f.customTitle || f.title,
      siteUrl: f.siteUrl,
      categoryId,
      needsPermission: !granted,
    });
  }
  const feedsAdded = (await getFeeds()).length - before;

  // Restore non-destructive settings (never the PIN).
  await saveSettings({ ...data.settings });

  return { feedsAdded, feedsSkipped: data.feeds.length - feedsAdded, categoriesAdded: 0 };
}

export async function exportOpmlString(): Promise<string> {
  return buildOpml(await getFeeds(), await getCategories());
}

export async function exportBackupString(): Promise<string> {
  return JSON.stringify(
    buildBackup(await getSettings(), await getFeeds(), await getCategories()),
    null,
    2,
  );
}
