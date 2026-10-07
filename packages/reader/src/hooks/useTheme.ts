import { useEffect, useState } from 'react';
import type { Settings, ThemePreference } from '@perch/core/types';
import { THEME_VARS, buildThemeVars, glassVars, type ColorMode } from '@perch/core/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The light/dark mode actually in effect, following the OS when set to "system". */
export function useEffectiveMode(theme: ThemePreference | undefined): ColorMode {
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (theme === 'light' || theme === 'dark') return theme;
  return systemDark ? 'dark' : 'light';
}

/**
 * Apply the theme to <html>. "system" removes the attribute and lets the CSS
 * `prefers-color-scheme` media query decide; custom colours for the effective
 * mode are layered on top as inline custom properties.
 */
export function useApplyTheme(settings: Pick<Settings, 'theme' | 'appearance' | 'glass'>) {
  const { theme, appearance, glass } = settings;
  const mode = useEffectiveMode(theme);
  const overrides = appearance?.[mode];
  const key = JSON.stringify(overrides ?? {});

  useEffect(() => {
    const root = document.documentElement;
    const custom = buildThemeVars(mode, overrides);

    for (const name of THEME_VARS) root.style.removeProperty(name);
    if (custom) {
      // The background picks the scheme (so native controls and scrollbars match).
      root.setAttribute('data-theme', custom.scheme);
      for (const [name, value] of Object.entries(custom.vars)) root.style.setProperty(name, value);
    } else if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }, [theme, mode, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Glass: transparency and blur as custom properties, or off altogether.
  const glassKey = JSON.stringify(glass ?? null);
  useEffect(() => {
    const root = document.documentElement;
    const vars = glassVars(glass);
    root.style.removeProperty('--glass-k');
    root.style.removeProperty('--glass-blur');
    if (!vars) {
      root.setAttribute('data-glass', 'off');
      return;
    }
    root.removeAttribute('data-glass');
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }, [glassKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return mode;
}
