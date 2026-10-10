import { useEffect, useState } from 'react';
import {
  Button,
  Row,
  Section,
  Spinner,
  Toggle,
  downloadText,
  pickTextFile,
  useSettings,
  useToast,
} from '@perch/reader';
import { ALL_SITES, hasAllSites, removeAllSites, requestAllSites } from '@/lib/permissions/host';
import { clearFullText } from '@/lib/storage/fulltext';
import {
  exportBackupString,
  exportOpmlString,
  importBackup,
  importOpml,
  type ImportResult,
} from '@/lib/backup';
import { clearPin, isPinEnabled, isValidPin, setPin } from '@/lib/lock';
import { CommunitySection } from './pages/Community';
import { SyncSection } from './pages/Sync';

// Settings that only exist in the extension: site permissions, sync, local
// backups, the PIN and the full-text cache. Rendered inside the shared page.

export function ExtensionSettings() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [autoGranted, setAutoGranted] = useState(false);

  useEffect(() => {
    void hasAllSites().then(setAutoGranted);
  }, []);

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
    <>
      <Section title="Feed discovery">
        <Row
          label="Auto-discover feeds on every site"
          hint="Off by default. When on, Perch is granted access to all sites so it can scan
            each page you visit for feeds and show an orange dot on the toolbar icon when it finds
            one. Turn it off to immediately revoke that access. When off, Perch only scans the
            current tab, and only when you open the popup."
        >
          <Toggle checked={settings.autoDiscovery && autoGranted} onChange={toggleAutoDiscovery} />
        </Row>
        {settings.autoDiscovery && !autoGranted && (
          <p className="text-[12px] text-[var(--text-muted)]">
            The all-sites permission (<code>{ALL_SITES}</code>) is currently not granted, so
            auto-discovery is inactive. Toggle it again to re-request.
          </p>
        )}
      </Section>

      <SyncSection />

      <CommunitySection />

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

      <Section title="About">
        <Row
          label="Privacy"
          hint="The extension collects nothing. Your library stays in this browser unless you sync it. A server you sign in to has its own policy."
        >
          <a
            href="https://perch.ws/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] font-medium text-[var(--accent-text)] hover:underline"
          >
            Privacy policy
          </a>
        </Row>
      </Section>
    </>
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
