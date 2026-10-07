import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useEffectiveMode } from '@/hooks/useTheme';
import { useWallpaperUrl } from '@/hooks/useWallpaper';
import { getSettings } from '@/lib/storage/settings';
import { clearWallpaper, saveWallpaper } from '@/lib/storage/wallpaper';
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  TEXT_PRESETS,
  hasOverrides,
  normalizeHex,
  resolvePalette,
  type ColorMode,
} from '@perch/core/theme';
import { pickFile } from '@/lib/util/download';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_DIM,
  type ColorOverrides,
  type Settings,
} from '@perch/core/types';
import { useToast } from '../components/Toasts';
import { Row, Section, Segmented } from './settings-ui';

type ColorKey = keyof ColorOverrides;
type Update = (patch: Partial<Settings>) => Promise<Settings>;

const SAVE_DELAY_MS = 120;

export function AppearanceSection({ settings, update }: { settings: Settings; update: Update }) {
  const toast = useToast();
  const effective = useEffectiveMode(settings.theme);
  // Which theme's palette is being edited. Follows the visible theme by default.
  const [editing, setEditing] = useState<ColorMode>(effective);
  useEffect(() => setEditing(effective), [effective]);

  const overrides = settings.appearance[editing];
  const palette = resolvePalette(editing, overrides);

  // Read the latest settings at write time, so quick successive edits (and the
  // debounced picker) never overwrite each other with a stale copy.
  const setColor = async (mode: ColorMode, key: ColorKey, hex: string | undefined) => {
    const current = await getSettings();
    await update({
      appearance: { ...current.appearance, [mode]: { ...current.appearance[mode], [key]: hex } },
    });
  };

  const resetColors = async () => {
    const current = await getSettings();
    await update({ appearance: { ...current.appearance, [editing]: {} } });
    toast(`${editing === 'dark' ? 'Dark' : 'Light'} theme colors reset`, 'info');
  };

  return (
    <Section title="Appearance">
      <Row label="Theme">
        <Segmented
          value={settings.theme}
          onChange={(v) => update({ theme: v as 'system' | 'light' | 'dark' })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>

      <Row
        label="Customize colors for"
        hint={`Light and dark each keep their own colors. You’re currently seeing the ${effective} theme${
          editing !== effective ? ', so changes here won’t show until you switch' : ''
        }.`}
      >
        <Segmented
          value={editing}
          onChange={(v) => setEditing(v as ColorMode)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>

      <ColorRow
        key={`bg-${editing}`}
        label="Background"
        hint="Borders, and text unless you pick a Text color, adjust automatically to stay readable on it."
        value={palette.background}
        custom={!!overrides.background}
        presets={BACKGROUND_PRESETS[editing]}
        onChange={(hex) => setColor(editing, 'background', hex)}
      />
      <ColorRow
        key={`text-${editing}`}
        label="Text"
        hint="Titles, menu items and article text. Secondary text is a softer shade of it."
        value={palette.text}
        custom={!!overrides.text}
        presets={TEXT_PRESETS[palette.scheme]}
        onChange={(hex) => setColor(editing, 'text', hex)}
      />
      <ColorRow
        key={`accent-${editing}`}
        label="Accent"
        hint="Unread dots, links, the selected item, unread counts and focus rings."
        value={palette.accent}
        custom={!!overrides.accent}
        presets={ACCENT_PRESETS}
        onChange={(hex) => setColor(editing, 'accent', hex)}
      />
      <ColorRow
        key={`button-${editing}`}
        label="Buttons"
        hint="Primary buttons, toggles and selected options. Their label color is picked for contrast."
        value={palette.button}
        custom={!!overrides.button}
        presets={ACCENT_PRESETS}
        onChange={(hex) => setColor(editing, 'button', hex)}
      />

      {hasOverrides(overrides) && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={resetColors}>
            Reset {editing} theme colors
          </Button>
        </div>
      )}

      <div className="h-px bg-[var(--border)]" />

      <WallpaperRows settings={settings} update={update} />
    </Section>
  );
}

// ---------------------------------------------------------------------------

function ColorRow({
  label,
  hint,
  value,
  custom,
  presets,
  onChange,
}: {
  label: string;
  hint: string;
  /** The colour currently in effect (custom or default). */
  value: string;
  custom: boolean;
  presets: string[];
  /** Persist a new colour, or `undefined` to go back to the default. */
  onChange: (hex: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastPickAt = useRef(0);

  // Follow outside changes (reset, another tab), but not the echoes of our own
  // saves while the user is still dragging in the picker.
  useEffect(() => {
    if (Date.now() - lastPickAt.current < 600) return;
    setDraft(value);
    setText(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // The native picker fires continuously while dragging; save at most every ~120ms.
  const pick = (hex: string, immediate = false) => {
    lastPickAt.current = Date.now();
    setDraft(hex);
    setText(hex);
    clearTimeout(timer.current);
    if (immediate) onChange(hex);
    else timer.current = setTimeout(() => onChange(hex), SAVE_DELAY_MS);
  };

  const commitText = () => {
    const hex = normalizeHex(text);
    if (hex) pick(hex, true);
    else setText(draft);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{label}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            {hint}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The swatch opens the browser's colour picker (RGB / HSL / hex + eyedropper). */}
          <label
            title="Open color picker"
            className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-[9px] border border-[var(--border-strong)] shadow-sm"
            style={{ background: draft }}
          >
            <input
              type="color"
              value={draft}
              onChange={(e) => pick(e.target.value)}
              aria-label={`${label} color`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => e.key === 'Enter' && commitText()}
            spellCheck={false}
            aria-label={`${label} hex value`}
            className="w-[84px] rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[12px] uppercase"
          />
          <button
            type="button"
            disabled={!custom}
            onClick={() => {
              clearTimeout(timer.current);
              lastPickAt.current = 0;
              onChange(undefined);
            }}
            className="rounded-md px-1.5 py-1 text-[11.5px] font-medium text-[var(--text-faint)] hover:text-[var(--text)] disabled:invisible"
          >
            Default
          </button>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {presets.map((hex) => (
          <button
            key={hex}
            type="button"
            title={hex}
            onClick={() => pick(hex, true)}
            className={`h-5 w-5 rounded-full border border-[var(--border-strong)] transition-transform hover:scale-110 ${
              draft === hex
                ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-solid)]'
                : ''
            }`}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WallpaperRows({ settings, update }: { settings: Settings; update: Update }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const wallpaper = settings.wallpaper;
  const preview = useWallpaperUrl(wallpaper?.id);

  const choose = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    setBusy(true);
    try {
      const id = await saveWallpaper(file);
      const current = (await getSettings()).wallpaper;
      await update({
        wallpaper: {
          id,
          dim: current?.dim ?? DEFAULT_WALLPAPER_DIM,
          blur: current?.blur ?? DEFAULT_WALLPAPER_BLUR,
        },
      });
      toast('Background image set', 'success');
    } catch (err) {
      toast((err as Error).message || 'Could not use that image', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await clearWallpaper();
    await update({ wallpaper: undefined });
    toast('Background image removed', 'info');
  };

  return (
    <>
      <Row
        label="Reader background image"
        hint="Shown behind the full-screen reader; panels turn translucent over it. Stored only
        on this device and not included in backups."
      >
        <div className="flex gap-2">
          <Button size="sm" variant="default" loading={busy} onClick={choose}>
            {wallpaper ? 'Replace…' : 'Choose image…'}
          </Button>
          {wallpaper && (
            <Button size="sm" variant="danger" onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      </Row>

      {wallpaper && (
        <div className="flex items-center gap-4">
          <div
            className="h-[72px] w-[120px] shrink-0 rounded-[10px] border border-[var(--border-strong)] bg-cover bg-center"
            style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Slider
              label="Dim"
              unit="%"
              min={0}
              max={90}
              value={wallpaper.dim}
              onChange={async (dim) => {
                const w = (await getSettings()).wallpaper;
                if (w) await update({ wallpaper: { ...w, dim } });
              }}
            />
            <Slider
              label="Blur"
              unit="px"
              min={0}
              max={24}
              value={wallpaper.blur}
              onChange={async (blur) => {
                const w = (await getSettings()).wallpaper;
                if (w) await update({ wallpaper: { ...w, blur } });
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <label className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
      <span className="w-9 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v), SAVE_DELAY_MS);
        }}
        className="min-w-0 flex-1 accent-[var(--button)]"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-[var(--text-faint)]">
        {draft}
        {unit}
      </span>
    </label>
  );
}
