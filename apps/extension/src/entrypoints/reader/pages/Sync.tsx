import { useEffect, useState } from 'react';
import { relativeTime } from '@perch/core/time';
import { Button, Row, Section, Spinner, useToast } from '@perch/reader';
import { sendMessage } from '@/lib/messaging';
import { requestHostPermission } from '@/lib/permissions/host';
import {
  ServerError,
  getServerInfo,
  normalizeServerUrl,
  signIn,
  signOutRemote,
  signUp,
} from '@/lib/sync/client';
import {
  clearAccount,
  getAccount,
  getStatus,
  saveAccount,
  watchSync,
  type SyncAccount,
  type SyncStatus,
} from '@/lib/sync/state';

const inputClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2.5 py-1.5 text-[13px]';

export function SyncSection() {
  const [account, setAccount] = useState<SyncAccount | null | undefined>(undefined);
  const [status, setStatus] = useState<SyncStatus>({ cursor: 0 });
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      void getAccount().then(setAccount);
      void getStatus().then(setStatus);
    };
    load();
    return watchSync(load);
  }, []);

  return (
    <Section title="Sync">
      {account === undefined ? (
        <Spinner size={14} />
      ) : account && !status.signedOut ? (
        <Connected account={account} status={status} />
      ) : formOpen || account ? (
        <SignInForm
          initial={account ?? undefined}
          notice={status.signedOut ? status.lastError : undefined}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <Row
          label="Sync with a Perch Server"
          hint="Keep subscriptions, read and starred articles, and settings in step across your
          browsers and phone. Use a server you run yourself. Your PIN and background image stay on
          this device."
        >
          <Button size="sm" variant="default" onClick={() => setFormOpen(true)}>
            Connect
          </Button>
        </Row>
      )}
    </Section>
  );
}

function Connected({ account, status }: { account: SyncAccount; status: SyncStatus }) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'sync' | 'out'>(null);

  const syncNow = async () => {
    setBusy('sync');
    try {
      await sendMessage('sync:now');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('out');
    await signOutRemote(account);
    await clearAccount();
    setBusy(null);
    toast('Signed out. Everything stays on this device.', 'info');
  };

  const host = new URL(account.server).host;
  return (
    <>
      <Row
        label={`Connected to ${host}`}
        hint={`Signed in as ${account.username}. ${
          status.lastSyncAt ? `Last synced ${relativeTime(status.lastSyncAt)}.` : 'Syncing…'
        }`}
      >
        <div className="flex gap-2">
          <Button size="sm" variant="default" loading={busy === 'sync'} onClick={syncNow}>
            Sync now
          </Button>
          <Button size="sm" variant="ghost" loading={busy === 'out'} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Row>
      {status.lastError && (
        <p className="text-[11.5px] text-[#ef4444]">Last sync failed: {status.lastError}</p>
      )}
    </>
  );
}

function SignInForm({
  initial,
  notice,
  onCancel,
}: {
  initial?: SyncAccount;
  notice?: string;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [server, setServer] = useState(initial?.server ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [needsInvite, setNeedsInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(notice ?? null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    let url: string;
    try {
      url = normalizeServerUrl(server);
    } catch {
      return setErr('That doesn’t look like a server address.');
    }
    if (!username.trim() || !password) return setErr('Enter a username and password.');

    // Ask for the server's origin first, while we still have the click.
    if (!(await requestHostPermission(url))) {
      return setErr(`Perch needs permission to talk to ${new URL(url).host}.`);
    }
    setBusy(true);
    try {
      const info = await getServerInfo(url);
      if (info.mode !== 'personal') {
        return setErr('This server runs in a mode this version of Perch can’t use yet.');
      }
      const account =
        mode === 'in'
          ? await signIn(url, username.trim(), password)
          : await signUp(url, username.trim(), password, invite.trim() || undefined);
      await saveAccount(account);
      toast(
        mode === 'in'
          ? `Signed in to ${new URL(url).host}`
          : `Account created on ${new URL(url).host}`,
        'success',
      );
    } catch (error) {
      const e = error as Error;
      if (e instanceof ServerError && e.code === 'invite-required') setNeedsInvite(true);
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium">
          {mode === 'in' ? 'Sign in to your Perch Server' : 'Create an account'}
        </div>
        <button
          type="button"
          className="text-[12px] font-medium text-[var(--accent-text)] hover:underline"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setErr(null);
          }}
        >
          {mode === 'in' ? 'Create an account instead' : 'I have an account'}
        </button>
      </div>
      <input
        className={inputClass}
        placeholder="Server address, e.g. reader.example.com"
        value={server}
        onChange={(e) => setServer(e.target.value)}
        autoFocus={!initial}
        spellCheck={false}
        autoCapitalize="off"
      />
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="off"
        />
        <input
          className={inputClass}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          autoFocus={Boolean(initial)}
        />
      </div>
      {mode === 'up' && needsInvite && (
        <input
          className={inputClass}
          placeholder="Invite code"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          spellCheck={false}
        />
      )}
      {err && <p className="text-[11.5px] text-[#ef4444]">{err}</p>}
      <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        Your password never leaves this device: Perch derives a key from it (Argon2id) and sends
        only that. Subscriptions you already have here are merged with the account’s.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" loading={busy}>
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={async () => {
            if (initial) await clearAccount();
            onCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
