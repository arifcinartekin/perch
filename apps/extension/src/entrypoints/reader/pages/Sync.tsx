import { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import {
  DEFAULT_CHAIN_SERVER,
  chainLink,
  normalizeChainCode,
  parseChainLink,
} from '@perch/core/chain';
import { relativeTime } from '@perch/core/time';
import { Button, Dialog, Row, Section, Spinner, useToast } from '@perch/reader';
import { sendMessage } from '@/lib/messaging';
import { requestHostPermission } from '@/lib/permissions/host';
import { createChain, deleteChain, joinChain } from '@/lib/sync/chain';
import {
  ServerError,
  deleteAccount,
  getServerInfo,
  normalizeServerUrl,
  signIn,
  requestEmailCode,
  resetPassword,
  signOutRemote,
  signUp,
} from '@/lib/sync/client';
import {
  clearAccount,
  getAccount,
  getStatus,
  isChain,
  saveAccount,
  watchSync,
  type ChainAccount,
  type ServerAccount,
  type SyncAccount,
  type SyncStatus,
} from '@/lib/sync/state';

const inputClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-2.5 py-1.5 text-[13px]';

export function SyncSection() {
  const [account, setAccount] = useState<SyncAccount | null | undefined>(undefined);
  const [status, setStatus] = useState<SyncStatus>({ cursor: 0 });
  const [form, setForm] = useState<null | 'server' | 'chain-new' | 'chain-join'>(null);
  /** Show the code right after starting a chain: the other devices need it. */
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const load = () => {
      void getAccount().then(setAccount);
      void getStatus().then(setStatus);
    };
    load();
    return watchSync(load);
  }, []);

  let body: React.ReactNode;
  if (account === undefined) {
    body = <Spinner size={14} />;
  } else if (account && isChain(account)) {
    body = (
      <ChainConnected
        account={account}
        status={status}
        showCode={showCode}
        onShowCode={setShowCode}
      />
    );
  } else if (account && !status.signedOut) {
    body = <Connected account={account} status={status} />;
  } else if (form === 'server' || account) {
    body = (
      <SignInForm
        initial={account ?? undefined}
        notice={status.signedOut ? status.lastError : undefined}
        onCancel={() => setForm(null)}
      />
    );
  } else if (form === 'chain-new' || form === 'chain-join') {
    body = (
      <ChainForm
        mode={form === 'chain-new' ? 'new' : 'join'}
        onDone={(created) => {
          setForm(null);
          setShowCode(created);
        }}
        onCancel={() => setForm(null)}
      />
    );
  } else {
    body = (
      <>
        <Row
          label="Sync chain"
          hint="Keep this browser, your other browsers and your phone in step without an account.
          Everything is encrypted on your devices with the chain’s code; the relay passing it on
          can’t read your feeds or what you read."
        >
          <div className="flex gap-2">
            <Button size="sm" variant="default" onClick={() => setForm('chain-new')}>
              Start a chain
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm('chain-join')}>
              Join
            </Button>
          </div>
        </Row>
        <Row
          label="Perch Server"
          hint="Sign in to an account on a Perch Server, such as one you run yourself. Your PIN and
          background image stay on this device either way."
        >
          <Button size="sm" variant="default" onClick={() => setForm('server')}>
            Connect
          </Button>
        </Row>
      </>
    );
  }

  return <Section title="Sync">{body}</Section>;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

function chainError(err: unknown, host: string): string {
  if (err instanceof ServerError) {
    if (err.code === 'chain-not-found') return `There’s no chain with this code on ${host}.`;
    if (err.code === 'chain-off' || err.status === 404) return `${host} doesn’t relay chains.`;
  }
  return (err as Error).message;
}

function ChainForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: 'new' | 'join';
  onDone: (created: boolean) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [server, setServer] = useState(DEFAULT_CHAIN_SERVER);
  const [otherRelay, setOtherRelay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    // A pasted link carries its relay along with the code.
    const link = parseChainLink(code);
    let url: string;
    try {
      url = normalizeServerUrl(link?.server ?? server);
    } catch {
      return setErr('That doesn’t look like a server address.');
    }
    const normalized = link?.code ?? normalizeChainCode(code);
    if (mode === 'join' && !normalized) {
      return setErr('That code isn’t complete or has a typo. It has 28 letters and digits.');
    }
    const host = new URL(url).host;
    if (!(await requestHostPermission(url))) {
      return setErr(`Perch needs permission to talk to ${host}.`);
    }
    setBusy(true);
    try {
      const info = await getServerInfo(url);
      if (!info.chain) return setErr(`${host} doesn’t relay chains.`);
      const account = mode === 'new' ? await createChain(url) : await joinChain(url, normalized!);
      await saveAccount(account);
      toast(mode === 'new' ? 'Chain started' : 'Joined the chain', 'success');
      onDone(mode === 'new');
    } catch (error) {
      setErr(chainError(error, host));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="text-[13px] font-medium">
        {mode === 'new' ? 'Start a sync chain' : 'Join a sync chain'}
      </div>
      {mode === 'join' ? (
        <input
          className={`${inputClass} font-mono tracking-wide`}
          placeholder="Chain code, e.g. 7GQ2-M4XD-…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
        />
      ) : (
        <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Perch makes a code for the chain. Enter it (or scan its QR code) on your other devices to
          add them. Subscriptions, categories, read and starred articles and settings sync; every
          device fetches the feeds itself.
        </p>
      )}
      {otherRelay ? (
        <input
          className={inputClass}
          placeholder="Relay address"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
        />
      ) : (
        <button
          type="button"
          className="self-start text-[12px] font-medium text-[var(--accent-text)] hover:underline"
          onClick={() => setOtherRelay(true)}
        >
          Relay: {new URL(DEFAULT_CHAIN_SERVER).host} · use another
        </button>
      )}
      {err && <p className="text-[11.5px] text-[#ef4444]">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" loading={busy}>
          {mode === 'new' ? 'Start chain' : 'Join chain'}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ChainConnected({
  account,
  status,
  showCode,
  onShowCode,
}: {
  account: ChainAccount;
  status: SyncStatus;
  showCode: boolean;
  onShowCode: (show: boolean) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'sync' | 'delete'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const host = new URL(account.server).host;

  const syncNow = async () => {
    setBusy('sync');
    try {
      await sendMessage('sync:now');
    } catch (err) {
      toast(chainError(err, host), 'error');
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    await clearAccount();
    toast('Left the chain. Everything stays on this device.', 'info');
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await deleteChain(account);
      await clearAccount();
      toast('Chain deleted. Everything stays on this device.', 'info');
    } catch (err) {
      toast(chainError(err, host), 'error');
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  if (status.signedOut) {
    return (
      <Row label="Sync chain ended" hint={status.lastError ?? 'This chain no longer exists.'}>
        <Button size="sm" variant="default" onClick={leave}>
          Leave
        </Button>
      </Row>
    );
  }

  return (
    <>
      <Row
        label="In a sync chain"
        hint={`Encrypted, through ${host}. ${
          status.lastSyncAt ? `Last synced ${relativeTime(status.lastSyncAt)}.` : 'Syncing…'
        }`}
      >
        <div className="flex gap-2">
          <Button size="sm" variant="default" onClick={() => onShowCode(true)}>
            Add a device
          </Button>
          <Button size="sm" variant="ghost" loading={busy === 'sync'} onClick={syncNow}>
            Sync now
          </Button>
        </div>
      </Row>
      {status.lastError && (
        <p className="text-[11.5px] text-[#ef4444]">Last sync failed: {status.lastError}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={leave}>
          Leave chain
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
          Delete chain…
        </Button>
      </div>

      {showCode && <ChainCodeDialog account={account} onClose={() => onShowCode(false)} />}
      {confirmDelete && (
        <Dialog
          title="Delete this chain?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={remove}>
                Delete chain
              </Button>
            </>
          }
        >
          <p className="text-[13px] leading-relaxed">
            The relay forgets the chain and every device in it stops syncing. Feeds, articles and
            settings stay on each device.
          </p>
        </Dialog>
      )}
    </>
  );
}

function ChainCodeDialog({ account, onClose }: { account: ChainAccount; onClose: () => void }) {
  const toast = useToast();
  const link = chainLink(account.server, account.code);
  const copy = async () => {
    await navigator.clipboard.writeText(account.code);
    toast('Code copied', 'success');
  };
  return (
    <Dialog
      title="Add a device to the chain"
      onClose={onClose}
      width={400}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={copy}>
            Copy code
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <QrCode text={link} label="QR code for joining the chain" />
        <code className="select-all rounded-[10px] bg-[color-mix(in_srgb,var(--text)_6%,transparent)] px-3 py-2 text-center font-mono text-[14px] tracking-wide">
          {account.code}
        </code>
        <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          On your iPhone, scan this with the Camera. In another browser, open Perch’s settings,
          choose Join under Sync chain and enter the code. Anyone with the code can read and change
          what this chain syncs, so keep it to yourself.
        </p>
      </div>
    </Dialog>
  );
}

/** Dark modules on white, whatever the theme, so cameras read it. */
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      width={200}
      height={200}
      shapeRendering="crispEdges"
      className="rounded-[12px]"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Perch Server accounts
// ---------------------------------------------------------------------------

function Connected({ account, status }: { account: ServerAccount; status: SyncStatus }) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'sync' | 'out' | 'delete'>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeAccount = async () => {
    setBusy('delete');
    setDeleteError(null);
    try {
      await deleteAccount(account, password);
      await clearAccount();
      toast('Account deleted. Everything on this device stays here.', 'info');
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

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
      <button
        type="button"
        className="mt-1 text-[11.5px] text-[var(--text-faint)] hover:text-[#ef4444]"
        onClick={() => setDeleting(true)}
      >
        Delete account…
      </button>
      {deleting && (
        <Dialog
          title="Delete your account?"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={busy === 'delete'}
                disabled={!password}
                onClick={removeAccount}
              >
                Delete account
              </Button>
            </>
          }
        >
          <p className="mb-3 text-[13px] text-[var(--text-muted)]">
            This removes your account on {host} with your feeds, read state, settings, notes and
            shared pages. It can’t be undone. What’s on this device stays here.
          </p>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password && void removeAccount()}
            className={inputClass}
          />
          {deleteError && <p className="mt-2 text-[11.5px] text-[#ef4444]">{deleteError}</p>}
        </Dialog>
      )}
    </>
  );
}

function SignInForm({
  initial,
  notice,
  onCancel,
}: {
  initial?: ServerAccount;
  notice?: string;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [server, setServer] = useState(initial?.server ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [needsInvite, setNeedsInvite] = useState(false);
  // Servers with email signup (and every password reset) confirm an address
  // first: 'address' asks for it, 'code' once the code is on its way.
  const [emailStep, setEmailStep] = useState<'address' | 'code' | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [canReset, setCanReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(notice ?? null);

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setEmailStep(next === 'reset' ? 'address' : null);
    setCode('');
    setErr(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    let url: string;
    try {
      url = normalizeServerUrl(server);
    } catch {
      return setErr('That doesn’t look like a server address.');
    }
    if (emailStep !== 'address' && ((mode !== 'reset' && !username.trim()) || !password)) {
      return setErr(mode === 'reset' ? 'Enter a new password.' : 'Enter a username and password.');
    }

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
      setCanReset(Boolean(info.email));
      const byEmail = mode === 'reset' || (mode === 'up' && info.signup === 'email');
      if (byEmail && emailStep !== 'code') {
        if (!email.trim()) {
          setEmailStep('address');
          return setErr(
            mode === 'reset' ? null : 'This server confirms your email address before signing up.',
          );
        }
        await requestEmailCode(url, email.trim(), mode === 'reset' ? 'reset' : 'signup');
        setEmailStep('code');
        return;
      }
      const confirmed = byEmail ? { email: email.trim(), emailCode: code.trim() } : {};
      const account =
        mode === 'in'
          ? await signIn(url, username.trim(), password)
          : mode === 'reset'
            ? await resetPassword(url, email.trim(), code.trim(), password)
            : await signUp(url, username.trim(), password, {
                invite: invite.trim() || undefined,
                ...confirmed,
              });
      await saveAccount(account);
      toast(
        mode === 'in'
          ? `Signed in to ${new URL(url).host}`
          : mode === 'reset'
            ? `New password set on ${new URL(url).host}`
            : `Account created on ${new URL(url).host}`,
        'success',
      );
    } catch (error) {
      const e = error as Error;
      if (e instanceof ServerError && e.code === 'invite-required') setNeedsInvite(true);
      if (e instanceof ServerError && e.code === 'invalid-credentials') setCanReset(true);
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium">
          {mode === 'in'
            ? 'Sign in to your Perch Server'
            : mode === 'reset'
              ? 'Reset your password'
              : 'Create an account'}
        </div>
        <button
          type="button"
          className="text-[12px] font-medium text-[var(--accent-text)] hover:underline"
          onClick={() => switchMode(mode === 'in' ? 'up' : 'in')}
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
      {emailStep && (
        <input
          className={inputClass}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailStep === 'code') setEmailStep('address');
          }}
          autoComplete="email"
        />
      )}
      {emailStep === 'code' && (
        <>
          <p className="text-[11.5px] text-[var(--text-muted)]">
            We sent a 6-digit code to {email.trim()}. It works for 10 minutes.
          </p>
          <input
            className={inputClass}
            placeholder="Code from the email"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            autoFocus
          />
        </>
      )}
      {emailStep !== 'address' && (
        <div className="flex gap-2">
          {mode !== 'reset' && (
            <input
              className={inputClass}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="off"
            />
          )}
          <input
            className={inputClass}
            type="password"
            placeholder={mode === 'reset' ? 'New password' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            autoFocus={Boolean(initial)}
          />
        </div>
      )}
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
      {mode === 'in' && canReset && (
        <button
          type="button"
          className="self-start text-[11.5px] font-medium text-[var(--accent-text)] hover:underline"
          onClick={() => switchMode('reset')}
        >
          Forgot your password?
        </button>
      )}
      <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        Your password never leaves this device: Perch derives a key from it (Argon2id) and sends
        only that. Subscriptions you already have here are merged with the account’s.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" loading={busy}>
          {emailStep === 'address'
            ? 'Send code'
            : mode === 'in'
              ? 'Sign in'
              : mode === 'reset'
                ? 'Set new password'
                : 'Create account'}
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
