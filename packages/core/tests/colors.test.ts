import { describe, expect, it } from 'vitest';
import {
  buildThemeVars,
  contrastText,
  isDarkColor,
  normalizeHex,
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
    expect(contrastText('#fde047')).toBe('#18181b');
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
    expect(out.vars['--text']).toBe('#18181b');
    // ...and default accent/button flip with it so they stay visible.
    expect(out.vars['--accent']).toBe('#18181b');
    expect(out.vars['--button']).toBe('#18181b');
  });

  it('applies accent and button independently', () => {
    const out = buildThemeVars('dark', { accent: '#3b82f6', button: '#fde047' })!;
    expect(out.scheme).toBe('dark');
    expect(out.vars['--bg']).toBe('#0a0a0b');
    expect(out.vars['--accent']).toBe('#3b82f6');
    expect(out.vars['--button']).toBe('#fde047');
    expect(out.vars['--button-contrast']).toBe('#18181b');
  });

  it('derives muted and faint text from a custom text colour', () => {
    const out = buildThemeVars('dark', { text: '#ffffff' })!;
    expect(out.vars['--text']).toBe('#ffffff');
    // 35% / 60% of the way toward the default dark background #0a0a0b.
    expect(out.vars['--text-muted']).toBe('#a9a9aa');
    expect(out.vars['--text-faint']).toBe('#6c6c6d');
  });

  it('resolves defaults per mode', () => {
    expect(resolvePalette('light')).toMatchObject({ background: '#f5f5f6', accent: '#18181b' });
    expect(resolvePalette('dark')).toMatchObject({ background: '#0a0a0b', accent: '#fafafa' });
  });
});
