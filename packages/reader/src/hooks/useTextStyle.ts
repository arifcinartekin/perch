import { useCallback, useEffect, useState } from 'react';

// The article's text size and line spacing, kept on this device only (like
// the iPhone and Android apps): a per-browser convenience in localStorage.

export interface TextStyle {
  /** Article text, in px. */
  size: number;
  /** Line height, as a multiple of the size. */
  lineHeight: number;
}

export const TEXT_SIZES = { min: 14, max: 26 };
export const LINE_HEIGHTS = [
  { label: 'Tight', value: 1.4 },
  { label: 'Normal', value: 1.7 },
  { label: 'Roomy', value: 1.95 },
] as const;
export const DEFAULT_TEXT_STYLE: TextStyle = { size: 16, lineHeight: 1.7 };

const KEY = 'perch.textStyle';
const EVENT = 'perch:text-style';

function read(): TextStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TextStyle> | null;
    const size = Math.round(Number(raw?.size));
    const lineHeight = Number(raw?.lineHeight);
    return {
      size: size >= TEXT_SIZES.min && size <= TEXT_SIZES.max ? size : DEFAULT_TEXT_STYLE.size,
      lineHeight: LINE_HEIGHTS.some((l) => l.value === lineHeight)
        ? lineHeight
        : DEFAULT_TEXT_STYLE.lineHeight,
    };
  } catch {
    return DEFAULT_TEXT_STYLE;
  }
}

export function useTextStyle() {
  const [style, setStyle] = useState<TextStyle>(read);

  // Other article panes on the page follow a change made in one.
  useEffect(() => {
    const sync = () => setStyle(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((patch: Partial<TextStyle>) => {
    const next = { ...read(), ...patch };
    next.size = Math.min(TEXT_SIZES.max, Math.max(TEXT_SIZES.min, Math.round(next.size)));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the change lasts until the page closes.
    }
    setStyle(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { style, update };
}
