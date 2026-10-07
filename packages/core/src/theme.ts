import type { ColorOverrides } from './types';

// User colour customisation. The stylesheet ships the default greyscale palette
// for light and dark; when the user picks their own colours we compute a full
// token set here and apply it as inline custom properties on <html>, which wins
// over the stylesheet.
//
// The background drives everything else: its luminance decides whether text,
// borders and the default accent/button use the light or the dark palette, so a
// user can't end up with near-white text on a near-white background.

export type ColorMode = 'light' | 'dark';

interface BasePalette {
  bg: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  shadow: string;
  /** Default accent / button colour (near-black or near-white). */
  ink: string;
}

const BASE: Record<ColorMode, BasePalette> = {
  light: {
    bg: '#f5f5f6',
    text: '#18181b',
    textMuted: '#52525b',
    textFaint: '#a1a1aa',
    border: 'rgba(24, 24, 27, 0.1)',
    borderStrong: 'rgba(24, 24, 27, 0.17)',
    shadow: '0 1px 2px rgba(24, 24, 27, 0.05), 0 12px 32px -12px rgba(24, 24, 27, 0.16)',
    ink: '#18181b',
  },
  dark: {
    bg: '#0a0a0b',
    text: '#e7e7ea',
    textMuted: '#9c9ca5',
    textFaint: '#64646d',
    border: 'rgba(255, 255, 255, 0.09)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.45), 0 20px 48px -16px rgba(0, 0, 0, 0.65)',
    ink: '#fafafa',
  },
};

/** The custom properties this module may set inline; cleared when unused. */
export const THEME_VARS = [
  '--bg',
  '--bg-solid',
  '--bg-elevated',
  '--text',
  '--text-muted',
  '--text-faint',
  '--border',
  '--border-strong',
  '--shadow',
  '--accent',
  '--accent-soft',
  '--accent-contrast',
  '--button',
  '--button-contrast',
] as const;

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise `#abc` / `abc` / `#AABBCC` to lowercase `#aabbcc`, or null if invalid. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = HEX_RE.exec(value.trim());
  if (!m) return null;
  let hex = m[1]!.toLowerCase();
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return `#${hex}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether a colour reads as "dark" (white text has more contrast than black). */
export function isDarkColor(hex: string): boolean {
  // Crossover where contrast against white equals contrast against black.
  return luminance(hex) < 0.179;
}

/** The readable foreground (near-white or near-black) for a fill colour. */
export function contrastText(hex: string): string {
  return isDarkColor(hex) ? '#fafafa' : '#18181b';
}

function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex([0, 1, 2].map((i) => ca[i]! + (cb[i]! - ca[i]!) * t) as [number, number, number]);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface ResolvedPalette {
  scheme: ColorMode;
  background: string;
  text: string;
  accent: string;
  button: string;
}

/** The effective colours for a theme mode after applying the user's overrides. */
export function resolvePalette(mode: ColorMode, overrides: ColorOverrides = {}): ResolvedPalette {
  const background = normalizeHex(overrides.background) ?? BASE[mode].bg;
  const scheme: ColorMode = overrides.background
    ? isDarkColor(background)
      ? 'dark'
      : 'light'
    : mode;
  const ink = BASE[scheme].ink;
  return {
    scheme,
    background,
    text: normalizeHex(overrides.text) ?? BASE[scheme].text,
    accent: normalizeHex(overrides.accent) ?? ink,
    button: normalizeHex(overrides.button) ?? ink,
  };
}

export function hasOverrides(overrides: ColorOverrides | undefined): boolean {
  return (
    !!overrides &&
    !!(overrides.background || overrides.text || overrides.accent || overrides.button)
  );
}

/**
 * Full set of inline custom properties for a mode + overrides, or null when the
 * user hasn't customised anything (the stylesheet defaults then apply as-is).
 */
export function buildThemeVars(
  mode: ColorMode,
  overrides: ColorOverrides | undefined,
): { scheme: ColorMode; vars: Record<(typeof THEME_VARS)[number], string> } | null {
  if (!hasOverrides(overrides)) return null;
  const p = resolvePalette(mode, overrides);
  const customText = !!normalizeHex(overrides?.text);
  const base = BASE[p.scheme];
  const solid =
    p.scheme === 'dark' ? mix(p.background, '#ffffff', 0.06) : mix(p.background, '#ffffff', 0.7);
  return {
    scheme: p.scheme,
    vars: {
      '--bg': p.background,
      '--bg-solid': solid,
      '--bg-elevated': rgba(solid, p.scheme === 'dark' ? 0.72 : 0.75),
      '--text': p.text,
      // A custom text colour also drives the secondary greys: the same steps
      // toward the background as the built-in palettes use.
      '--text-muted': customText ? mix(p.text, p.background, 0.35) : base.textMuted,
      '--text-faint': customText ? mix(p.text, p.background, 0.6) : base.textFaint,
      '--border': base.border,
      '--border-strong': base.borderStrong,
      '--shadow': base.shadow,
      '--accent': p.accent,
      '--accent-soft': rgba(p.accent, p.scheme === 'dark' ? 0.14 : 0.1),
      '--accent-contrast': contrastText(p.accent),
      '--button': p.button,
      '--button-contrast': contrastText(p.button),
    },
  };
}

/** Swatches offered next to the colour pickers. */
export const ACCENT_PRESETS = [
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
];

export const BACKGROUND_PRESETS: Record<ColorMode, string[]> = {
  dark: ['#0a0a0b', '#000000', '#111827', '#1e1e2e', '#002b36', '#282828', '#1a1b26'],
  light: ['#f5f5f6', '#ffffff', '#fdf6e3', '#f4ecd8', '#eff1f5', '#eef2f7'],
};

/** Text swatches, keyed by the scheme the background resolves to. */
export const TEXT_PRESETS: Record<ColorMode, string[]> = {
  dark: ['#e7e7ea', '#ffffff', '#d4d4d8', '#f5e6c8', '#cdd6f4', '#93a1a1', '#a9b1d6'],
  light: ['#18181b', '#000000', '#3f3f46', '#433422', '#4c4f69', '#586e75'],
};
