import { useEffect } from 'react';
import type { ThemePreference } from '@/lib/types';

/**
 * Apply a theme preference to <html>. "system" removes the attribute and lets
 * the CSS `prefers-color-scheme` media query decide.
 */
export function useApplyTheme(theme: ThemePreference | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }, [theme]);
}
