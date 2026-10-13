import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/IconButton';
import { IconMinus, IconPlus } from '../components/icons';
import {
  DEFAULT_TEXT_STYLE,
  LINE_HEIGHTS,
  TEXT_SIZES,
  type TextStyle,
} from '../hooks/useTextStyle';

interface Props {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}

/** The "Aa" button in the article header: text size and line spacing. */
export function TextStyleMenu({ style, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const isDefault =
    style.size === DEFAULT_TEXT_STYLE.size && style.lineHeight === DEFAULT_TEXT_STYLE.lineHeight;

  return (
    <div ref={root} className="relative">
      <IconButton
        label="Text size and spacing"
        active={open}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[13px] font-semibold leading-none">Aa</span>
      </IconButton>
      {open && (
        <div
          role="dialog"
          aria-label="Text size and spacing"
          className="glass-strong absolute right-0 top-9 z-30 w-60 rounded-xl border border-[var(--border)] p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <IconButton
              label="Smaller"
              disabled={style.size <= TEXT_SIZES.min}
              onClick={() => onChange({ size: style.size - 1 })}
            >
              <IconMinus size={14} />
            </IconButton>
            <input
              type="range"
              aria-label="Text size"
              min={TEXT_SIZES.min}
              max={TEXT_SIZES.max}
              step={1}
              value={style.size}
              onChange={(e) => onChange({ size: Number(e.target.value) })}
              className="flex-1 accent-[var(--accent)]"
            />
            <IconButton
              label="Larger"
              disabled={style.size >= TEXT_SIZES.max}
              onClick={() => onChange({ size: style.size + 1 })}
            >
              <IconPlus size={14} />
            </IconButton>
          </div>
          <p className="mb-1 mt-3 text-[11.5px] font-medium text-[var(--text-muted)]">
            Line spacing
          </p>
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            {LINE_HEIGHTS.map((l) => (
              <button
                key={l.value}
                type="button"
                aria-pressed={style.lineHeight === l.value}
                onClick={() => onChange({ lineHeight: l.value })}
                className={`flex-1 rounded-md py-1 text-[12px] transition-colors ${
                  style.lineHeight === l.value
                    ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={isDefault}
            onClick={() => onChange(DEFAULT_TEXT_STYLE)}
            className="mt-3 w-full text-center text-[12px] text-[var(--accent-text)] disabled:text-[var(--text-faint)]"
          >
            Default size
          </button>
          <p className="mt-1 text-center text-[11px] text-[var(--text-faint)]">
            Only in this browser.
          </p>
        </div>
      )}
    </div>
  );
}
