import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft } from '@/components/icons';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Spinner';
import { useSettings } from '@/hooks/useSettings';
import { useToast } from '../components/Toasts';
import { ALL_SITES, hasAllSites, removeAllSites, requestAllSites } from '@/lib/permissions/host';
import { MIN_REFRESH_MINUTES } from '@/lib/types';
import { clearFullText } from '@/lib/storage/fulltext';
import {
  exportBackupString,
  exportOpmlString,
  importBackup,
  importOpml,
  type ImportResult,
} from '@/lib/backup';
import { downloadText, pickTextFile } from '@/lib/util/download';
import { clearPin, isPinEnabled, isValidPin, setPin } from '@/lib/lock';

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
            <p className="text-[12px] text-[var(--text-muted)]">
              The all-sites permission (<code>{ALL_SITES}</code>) is currently not granted, so
              auto-discovery is inactive. Toggle it again to re-request.
            </p>
          )}
        </Section>

        <BackupSection />

        <LockSection />

        <Section title="Storage">
          <Row label="Full-text cache" hint="Extracted article bodies stored for offline reading.">
            <button
              onClick={async () => {
                await clearFullText();
                toast('Full-text cache cleared', 'success');
              }}
              className="rounded-[9px] border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] font-medium hover:bg-[var(--accent-soft)]"
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

// ---------------------------------------------------------------------------

function BackupSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'opml' | 'json' | 'import'>(null);

  const summarize = (r: ImportResult) =>
    `Imported ${r.feedsAdded} feed${r.feedsAdded === 1 ? '' : 's'}` +
    (r.categoriesAdded ? `, ${r.categoriesAdded} categories` : '') +
    (r.feedsSkipped ? ` (${r.feedsSkipped} already present)` : '');

  const doImport = async () => {
    setBusy('import');
    try {
      const file = await pickTextFile('.opml,.xml,.json,application/xml,application/json,text/xml');
      if (!file) return;
      const isJson =
        file.name.toLowerCase().endsWith('.json') || file.text.trimStart().startsWith('{');
      const result = isJson ? await importBackup(file.text, 'merge') : await importOpml(file.text);
      toast(summarize(result), 'success');
    } catch (err) {
      toast((err as Error).message || 'Import failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Backup & export">
      <Row
        label="Export your subscriptions"
        hint="OPML works with any other reader. The Perch backup also includes your categories and
        settings (never your PIN)."
      >
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            loading={busy === 'opml'}
            onClick={async () => {
              setBusy('opml');
              try {
                downloadText('perch-subscriptions.opml', await exportOpmlString(), 'text/x-opml');
                toast('OPML exported', 'success');
              } finally {
                setBusy(null);
              }
            }}
          >
            OPML
          </Button>
          <Button
            size="sm"
            variant="default"
            loading={busy === 'json'}
            onClick={async () => {
              setBusy('json');
              try {
                downloadText('perch-backup.json', await exportBackupString(), 'application/json');
                toast('Backup exported', 'success');
              } finally {
                setBusy(null);
              }
            }}
          >
            Full backup
          </Button>
        </div>
      </Row>
      <Row
        label="Import"
        hint="Add feeds from an OPML file or a Perch backup. Existing feeds are kept."
      >
        <Button size="sm" variant="default" loading={busy === 'import'} onClick={doImport}>
          Choose file…
        </Button>
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function LockSection() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setting, setSetting] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void isPinEnabled().then(setEnabled);
  }, []);

  const cancel = () => {
    setSetting(false);
    setPin1('');
    setPin2('');
    setErr(null);
  };

  const savePin = async () => {
    if (!isValidPin(pin1)) return setErr('The PIN must be exactly 6 digits.');
    if (pin1 !== pin2) return setErr('The two PINs don’t match.');
    await setPin(pin1);
    setEnabled(true);
    cancel();
    toast('PIN set', 'success');
  };

  const removePin = async () => {
    await clearPin();
    setEnabled(false);
    toast('PIN removed', 'info');
  };

  return (
    <Section title="Lock">
      <Row
        label="Require a PIN to open the reader"
        hint="A 6-digit code asked once per browser session. This is a convenience lock, not real
        security — the data is still stored unencrypted on this device."
      >
        {enabled === null ? (
          <Spinner size={14} />
        ) : enabled && !setting ? (
          <div className="flex gap-2">
            <Button size="sm" variant="default" onClick={() => setSetting(true)}>
              Change
            </Button>
            <Button size="sm" variant="danger" onClick={removePin}>
              Remove
            </Button>
          </div>
        ) : !setting ? (
          <Button size="sm" variant="default" onClick={() => setSetting(true)}>
            Set a PIN
          </Button>
        ) : null}
      </Row>

      {setting && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={pin1}
              inputMode="numeric"
              maxLength={6}
              placeholder="New 6-digit PIN"
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-40 rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2.5 py-1.5 text-[13px] tracking-[0.3em]"
            />
            <input
              value={pin2}
              inputMode="numeric"
              maxLength={6}
              placeholder="Confirm"
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-40 rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2.5 py-1.5 text-[13px] tracking-[0.3em]"
            />
          </div>
          {err && <p className="text-[11.5px] text-[#ef4444]">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={savePin}>
              Save PIN
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

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
              : 'text-[var(--text-muted)] hover:bg-[var(--accent-soft)]'
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
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full px-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        checked ? 'bg-[var(--accent)]' : 'bg-[color-mix(in_srgb,var(--text)_28%,transparent)]'
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-[var(--accent-contrast)] shadow transition-transform duration-150 ${
          checked ? 'translate-x-[16px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
