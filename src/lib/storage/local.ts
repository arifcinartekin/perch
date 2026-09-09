import { browser } from 'wxt/browser';

// Thin typed wrapper over `browser.storage.local`. Used for the small, rarely
// changing records: settings, the feed list, and categories. Larger data
// (articles, full-text cache) lives in IndexedDB — see ./db.ts.

export const KEYS = {
  settings: 'perch:settings',
  feeds: 'perch:feeds',
  categories: 'perch:categories',
  schemaVersion: 'perch:schemaVersion',
} as const;

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const result = await browser.storage.local.get(key);
  const value = result[key];
  return value === undefined ? fallback : (value as T);
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

/**
 * Subscribe to changes for a single local-storage key. Returns an unsubscribe
 * function. Fires with the new value whenever any context writes that key.
 */
export function watchLocal<T>(key: string, onChange: (value: T | undefined) => void): () => void {
  const listener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && key in changes) {
      onChange(changes[key]!.newValue as T | undefined);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
