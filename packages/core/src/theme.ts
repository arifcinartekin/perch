import { DEFAULT_GLASS, MAX_GLASS_BLUR, type ColorOverrides, type GlassSettings } from './types';

// Perch's palette and user colour customisation. The stylesheet ships the
// default palette for light and dark; when the user picks their own colours we
// compute a full token set here and apply it as inline custom properties on
// <html>, which wins over the stylesheet. The iOS app mirrors BRAND.
//
// The background drives everything else: its luminance decides whether text,
// borders and glass use the light or the dark palette, so a user can't end up
// with near-white text on a near-white background.

export type ColorMode = 'light' | 'dark';

/** The logo's colours. */
export const BRAND = {
  /** Ember: beak, RSS waves, the perch. */
  accent: '#ff7a1a',
  /** Ink: the bird on light backgrounds; text. */
  ink: '#12151c',
  /** Cream: the bird on dark backgrounds; text in dark mode. */
  cream: '#f4f1ea',
  /** Night: the app icon's gradient. */
  nightTop: '#1b2030',
  nightBottom: '#0a0c12',
} as const;

interface BasePalette {
  bg: string;
  solid: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  shadow: string;
  /** Glass: how see-through the frames are at the default setting, edge and top highlight. */
  glassClear: number;
  glassEdge: string;
  glassHighlight: string;
}

const BASE: Record<ColorMode, BasePalette> = {
  light: {
    bg: '#f7f5f0',
    solid: '#ffffff',
    text: BRAND.ink,
    textMuted: '#555a66',
    textFaint: '#9a9da6',
    border: 'rgba(18, 21, 28, 0.09)',
    borderStrong: 'rgba(18, 21, 28, 0.16)',
    shadow: '0 1px 2px rgba(18, 21, 28, 0.05), 0 12px 32px -12px rgba(18, 21, 28, 0.18)',
    glassClear: 42,
    glassEdge: 'rgba(18, 21, 28, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.85)',
  },
  dark: {
    bg: '#0e1118',
    solid: '#161a24',
    text: BRAND.cream,
    textMuted: '#b8b4aa',
    textFaint: '#7d7a73',
    border: 'rgba(244, 241, 234, 0.08)',
    borderStrong: 'rgba(244, 241, 234, 0.15)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.45), 0 20px 48px -16px rgba(0, 0, 0, 0.7)',
    glassClear: 48,
    glassEdge: 'rgba(244, 241, 234, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.07)',
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
  '--accent-text',
  '--button',
  '--button-contrast',
  '--glass-clear',
  '--glass-edge',
  '--glass-highlight',
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

/** The readable foreground (cream or ink) for a fill colour. */
export function contrastText(hex: string): string {
  return isDarkColor(hex) ? '#fafafa' : BRAND.ink;
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent as a text colour on `background`: itself when it is readable
 * (4.5:1), otherwise nudged toward black or white until it is. Orange links on
 * a cream page come out burnt orange; on a dark page they stay bright.
 */
export function readableOn(color: string, background: string, ratio = 4.5): string {
  const target = isDarkColor(background) ? '#ffffff' : '#000000';
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = mix(color, target, t);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return target;
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

/**
 * Inline custom properties for the glass setting: `--glass-k` scales every
 * surface's transparency (1 = the default look, 0 = solid, 2 = twice as clear)
 * and `--glass-blur` is the frames' blur radius. Null when glass is off.
 */
export function glassVars(glass: GlassSettings | undefined): Record<string, string> | null {
  const g = normalizeGlass(glass) ?? DEFAULT_GLASS;
  if (!g.enabled) return null;
  return { '--glass-k': String(g.transparency / 50), '--glass-blur': `${g.blur}px` };
}

/** A stored or synced glass setting made safe: numbers clamped, junk dropped. */
export function normalizeGlass(value: unknown): GlassSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const g = value as Partial<GlassSettings>;
  const clamp = (v: unknown, max: number, fallback: number) => {
    const n = Number(v);
    return Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : fallback)));
  };
  return {
    enabled: g.enabled !== false,
    transparency: clamp(g.transparency, 100, DEFAULT_GLASS.transparency),
    blur: clamp(g.blur, MAX_GLASS_BLUR, DEFAULT_GLASS.blur),
  };
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
  return {
    scheme,
    background,
    text: normalizeHex(overrides.text) ?? BASE[scheme].text,
    accent: normalizeHex(overrides.accent) ?? BRAND.accent,
    button: normalizeHex(overrides.button) ?? BRAND.accent,
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
      '--accent-soft': rgba(p.accent, p.scheme === 'dark' ? 0.16 : 0.14),
      '--accent-contrast': contrastText(p.accent),
      '--accent-text': readableOn(p.accent, p.background),
      '--button': p.button,
      '--button-contrast': contrastText(p.button),
      '--glass-clear': `${base.glassClear}%`,
      '--glass-edge': base.glassEdge,
      '--glass-highlight': base.glassHighlight,
    },
  };
}

/** Swatches offered next to the colour pickers. */
export const ACCENT_PRESETS = [
  BRAND.accent,
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#14b8a6',
];

export const BACKGROUND_PRESETS: Record<ColorMode, string[]> = {
  dark: ['#0e1118', '#000000', '#0a0a0b', '#111827', '#1e1e2e', '#002b36', '#282828'],
  light: ['#f7f5f0', '#ffffff', '#f5f5f6', '#fdf6e3', '#eff1f5', '#eef2f7'],
};

/** Text swatches, keyed by the scheme the background resolves to. */
export const TEXT_PRESETS: Record<ColorMode, string[]> = {
  dark: ['#f4f1ea', '#ffffff', '#e7e7ea', '#d4d4d8', '#cdd6f4', '#93a1a1', '#a9b1d6'],
  light: ['#12151c', '#000000', '#18181b', '#3f3f46', '#433422', '#4c4f69'],
};
