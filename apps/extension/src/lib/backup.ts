import { buildOpml, parseOpml } from '@perch/core/opml';
import { addCategory, getCategories, saveCategories } from './storage/categories';
import { addFeed, getFeeds, saveFeeds } from './storage/feeds';
import { getSettings, saveSettings } from './storage/settings';
import { hasHostPermission } from './permissions/host';
import { UNCATEGORIZED_ID, type Category, type Feed, type Settings } from '@perch/core/types';

export { buildOpml, parseOpml, type ParsedOpml } from '@perch/core/opml';

// Import / export of the feed list. Everything is local, so a user can take a
// backup and move between machines. Two formats:
//   - OPML 2.0  — the portable standard, works with any other reader.
//   - Perch JSON — a full backup of feeds + categories + settings (never the PIN).

// ---------------------------------------------------------------------------
// Perch JSON backup
// ---------------------------------------------------------------------------

export interface PerchBackup {
  app: 'perch';
  version: 1;
  exportedAt: number;
  settings: Omit<Settings, 'pinSalt' | 'pinHash' | 'wallpaper'>;
  categories: Category[];
  feeds: Feed[];
}

export function buildBackup(
  settings: Settings,
  feeds: Feed[],
  categories: Category[],
): PerchBackup {
  // The PIN never leaves the device; the wallpaper image lives in IndexedDB and
  // isn't part of the backup, so its settings would only point at nothing.
  const { pinSalt: _s, pinHash: _h, wallpaper: _w, ...safeSettings } = settings;
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
