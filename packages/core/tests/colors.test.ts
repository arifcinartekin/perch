import { describe, expect, it } from 'vitest';
import {
  buildThemeVars,
  contrastText,
  contrastRatio,
  glassVars,
  isDarkColor,
  normalizeHex,
  readableOn,
  resolvePalette,
} from '../src/theme';

describe('normalizeHex', () => {
  it('accepts short, long and unprefixed hex', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('112233')).toBe('#112233');
    expect(normalizeHex(' #0a0A0b ')).toBe('#0a0a0b');
  });
  it('rejects anything else', () => {
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe('contrast helpers', () => {
  it('classifies light and dark colours', () => {
    expect(isDarkColor('#000000')).toBe(true);
    expect(isDarkColor('#1e1e2e')).toBe(true);
    expect(isDarkColor('#ffffff')).toBe(false);
    expect(isDarkColor('#f59e0b')).toBe(false);
  });
  it('picks a readable label colour', () => {
    expect(contrastText('#1d4ed8')).toBe('#fafafa');
    expect(contrastText('#fde047')).toBe('#12151c');
    // The brand orange takes ink, not white (7:1 vs 2.6:1).
    expect(contrastText('#ff7a1a')).toBe('#12151c');
  });
  it('makes an accent readable as text on any background', () => {
    expect(readableOn('#ff7a1a', '#f7f5f0')).toBe('#b35512');
    expect(readableOn('#ff7a1a', '#0e1118')).toBe('#ff7a1a');
    for (const bg of ['#ffffff', '#f7f5f0', '#000000', '#1e1e2e', '#fdf6e3']) {
      for (const accent of ['#ff7a1a', '#fde047', '#3b82f6', '#22c55e']) {
        expect(contrastRatio(readableOn(accent, bg), bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('theme vars', () => {
  it('returns null when nothing is customised', () => {
    expect(buildThemeVars('dark', {})).toBeNull();
    expect(buildThemeVars('dark', undefined)).toBeNull();
  });

  it('derives text from the background, not the theme', () => {
    // A light background chosen for the dark theme must get dark text.
    const out = buildThemeVars('dark', { background: '#fdf6e3' })!;
    expect(out.scheme).toBe('light');
    expect(out.vars['--text']).toBe('#12151c');
    // The brand accent stays, and its text form is darkened to stay readable.
    expect(out.vars['--accent']).toBe('#ff7a1a');
    expect(out.vars['--button']).toBe('#ff7a1a');
    expect(out.vars['--accent-text']).not.toBe('#ff7a1a');
  });

  it('applies accent and button independently', () => {
    const out = buildThemeVars('dark', { accent: '#3b82f6', button: '#fde047' })!;
    expect(out.scheme).toBe('dark');
    expect(out.vars['--bg']).toBe('#0e1118');
    expect(out.vars['--accent']).toBe('#3b82f6');
    expect(out.vars['--button']).toBe('#fde047');
    expect(out.vars['--button-contrast']).toBe('#12151c');
    expect(out.vars['--glass-clear']).toMatch(/^\d+%$/);
  });

  it('derives muted and faint text from a custom text colour', () => {
    const out = buildThemeVars('dark', { text: '#ffffff' })!;
    expect(out.vars['--text']).toBe('#ffffff');
    // 35% / 60% of the way toward the default dark background #0e1118.
    expect(out.vars['--text-muted']).toBe(mixHex('#ffffff', '#0e1118', 0.35));
    expect(out.vars['--text-faint']).toBe(mixHex('#ffffff', '#0e1118', 0.6));
  });

  it('resolves defaults per mode', () => {
    expect(resolvePalette('light')).toMatchObject({ background: '#f7f5f0', accent: '#ff7a1a' });
    expect(resolvePalette('dark')).toMatchObject({ background: '#0e1118', accent: '#ff7a1a' });
  });
});

function mixHex(a: string, b: string, t: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

describe('glassVars', () => {
  it('maps the default to the stylesheet look', () => {
    expect(glassVars(undefined)).toEqual({ '--glass-k': '1', '--glass-blur': '24px' });
  });

  it('scales transparency and clamps out-of-range values', () => {
    expect(glassVars({ enabled: true, transparency: 0, blur: 99 })).toEqual({
      '--glass-k': '0',
      '--glass-blur': '40px',
    });
    expect(glassVars({ enabled: true, transparency: 100, blur: -3 })!['--glass-k']).toBe('2');
  });

  it('is null when glass is off', () => {
    expect(glassVars({ enabled: false, transparency: 50, blur: 24 })).toBeNull();
  });
});
