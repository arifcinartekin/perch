import { DEFAULT_SETTINGS, MIN_REFRESH_MINUTES, type Settings } from '../types';
import { getLocal, setLocal, watchLocal, KEYS } from './local';

export async function getSettings(): Promise<Settings> {
  const stored = await getLocal<Partial<Settings>>(KEYS.settings, {});
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await setLocal(KEYS.settings, next);
  return next;
}

export function watchSettings(onChange: (settings: Settings) => void): () => void {
  return watchLocal<Partial<Settings>>(KEYS.settings, (value) => {
    onChange(normalizeSettings({ ...DEFAULT_SETTINGS, ...(value ?? {}) }));
  });
}

function normalizeSettings(s: Settings): Settings {
  return {
    ...s,
    refreshIntervalMinutes: Math.max(
      MIN_REFRESH_MINUTES,
      Math.round(Number(s.refreshIntervalMinutes) || DEFAULT_SETTINGS.refreshIntervalMinutes),
    ),
    openMode: s.openMode === 'window' ? 'window' : 'tab',
    defaultViewMode: s.defaultViewMode === 'fulltext' ? 'fulltext' : 'summary',
    theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : 'system',
    readingFont: s.readingFont === 'serif' ? 'serif' : 'sans',
    autoDiscovery: Boolean(s.autoDiscovery),
  };
}
