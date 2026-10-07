import {
  DEFAULT_SETTINGS,
  MIN_REFRESH_MINUTES,
  type ColorOverrides,
  type Settings,
  type WallpaperSettings,
} from '@perch/core/types';
import { normalizeHex } from '@perch/core/theme';
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
    theme: ['light', 'dark', 'system'].includes(s.theme) ? s.theme : 'system',
    readingFont: s.readingFont === 'serif' ? 'serif' : 'sans',
    autoDiscovery: Boolean(s.autoDiscovery),
    appearance: {
      light: normalizeColors(s.appearance?.light),
      dark: normalizeColors(s.appearance?.dark),
    },
    wallpaper: normalizeWallpaper(s.wallpaper),
  };
}

function normalizeColors(c: ColorOverrides | undefined): ColorOverrides {
  const out: ColorOverrides = {};
  for (const key of ['background', 'text', 'accent', 'button'] as const) {
    const hex = normalizeHex(c?.[key]);
    if (hex) out[key] = hex;
  }
  return out;
}

function normalizeWallpaper(w: WallpaperSettings | undefined): WallpaperSettings | undefined {
  if (!w || typeof w.id !== 'string' || !w.id) return undefined;
  const clamp = (v: unknown, max: number, fallback: number) =>
    Math.min(max, Math.max(0, Math.round(Number.isFinite(Number(v)) ? Number(v) : fallback)));
  return { id: w.id, dim: clamp(w.dim, 90, 35), blur: clamp(w.blur, 24, 0) };
}
