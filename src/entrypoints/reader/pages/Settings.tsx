import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft } from '@/components/icons';
import { Spinner } from '@/components/Spinner';
import { useSettings } from '@/hooks/useSettings';
import { useToast } from '../components/Toasts';
import { ALL_SITES, hasAllSites, removeAllSites, requestAllSites } from '@/lib/permissions/host';
import { MIN_REFRESH_MINUTES } from '@/lib/types';
import { clearFullText } from '@/lib/storage/fulltext';

export function Settings() {
  const { settings, loaded, update } = useSettings();
  const toast = useToast();
  const [autoGranted, setAutoGranted] = useState(false);

  useEffect(() => {
    void hasAllSites().then(setAutoGranted);
  }, []);

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  }

  const toggleAutoDiscovery = async (next: boolean) => {
    if (next) {
      const granted = await requestAllSites();
      setAutoGranted(granted);
      if (!granted) {
        toast('Permission was not granted', 'error');
        return;
      }
      await update({ autoDiscovery: true });
      toast('Auto-discovery on — Perch will scan pages as you browse', 'success');
    } else {
      await update({ autoDiscovery: false });
      await removeAllSites();
      setAutoGranted(false);
      toast('Auto-discovery off — all-sites access removed', 'info');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-6 py-8">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <IconArrowLeft size={14} /> Back to reader
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--text-faint)]">
          Everything is stored locally in your browser. Nothing is sent anywhere.
        </p>

        <Section title="Reading">
          <Row label="Open the reader as" hint="Where “Open RSS Reader” takes you.">
            <Segmented
              value={settings.openMode}
              onChange={(v) => update({ openMode: v as 'tab' | 'window' })}
              options={[
                { value: 'tab', label: 'Browser tab' },
                { value: 'window', label: 'App window' },
              ]}
            />
          </Row>
          <Row label="Default article view">
            <Segmented
              value={settings.defaultViewMode}
              onChange={(v) => update({ defaultViewMode: v as 'summary' | 'fulltext' })}
              options={[
                { value: 'summary', label: 'Summary' },
                { value: 'fulltext', label: 'Full text' },
              ]}
            />
          </Row>
          <Row label="Reading font">
            <Segmented
              value={settings.readingFont}
              onChange={(v) => update({ readingFont: v as 'sans' | 'serif' })}
              options={[
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
              ]}
            />
          </Row>
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
        </Section>

        <Section title="Refreshing">
          <Row
            label="Background refresh interval"
            hint={`How often Perch checks your feeds in the background. Minimum ${MIN_REFRESH_MINUTES} minutes.`}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={MIN_REFRESH_MINUTES}
                value={settings.refreshIntervalMinutes}
                onChange={(e) =>
                  update({ refreshIntervalMinutes: Number(e.target.value) || MIN_REFRESH_MINUTES })
                }
                className="w-20 rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px]"
              />
              <span className="text-[12px] text-[var(--text-faint)]">minutes</span>
            </div>
          </Row>
        </Section>

        <Section title="Feed discovery">
          <Row
            label="Auto-discover feeds on every site"
            hint="Off by default. When on, Perch is granted access to all sites so it can scan
            each page you visit for feeds and show a red dot on the toolbar icon when it finds
            one. Turn it off to immediately revoke that access. When off, Perch only scans the
            current tab, and only when you open the popup."
          >
            <Toggle
              checked={settings.autoDiscovery && autoGranted}
              onChange={toggleAutoDiscovery}
            />
          </Row>
          {settings.autoDiscovery && !autoGranted && (
            <p className="text-[12px] text-[#f59e0b]">
              The all-sites permission (<code>{ALL_SITES}</code>) is currently not granted, so
              auto-discovery is inactive. Toggle it again to re-request.
            </p>
          )}
        </Section>

        <Section title="Storage">
          <Row label="Full-text cache" hint="Extracted article bodies stored for offline reading.">
            <button
              onClick={async () => {
                await clearFullText();
                toast('Full-text cache cleared', 'success');
              }}
              className="rounded-[9px] border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] font-medium hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
            >
              Clear cache
            </button>
          </Row>
        </Section>

        <p className="mt-10 text-[11.5px] text-[var(--text-faint)]">
          Perch is open source and MIT licensed. Feeds, articles, and favicons are fetched only from
          sites you have added.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        {title}
      </h2>
      <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--bg-solid)] p-4">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex overflow-hidden rounded-[9px] border border-[var(--border-strong)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            value === o.value
              ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
              : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors ${
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
