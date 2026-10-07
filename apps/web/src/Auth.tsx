import { useState } from 'react';
import type { AuthResponse, PreloginResponse, PublicUser, ServerInfo } from '@perch/core/api';
import { DEFAULT_KDF, deriveKeys, newSalt } from '@perch/core/auth';
import { Button, IconRss } from '@perch/reader';
import { ServerError, api } from './api';

const inputClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]';

/** Sign in or create an account. The password is stretched here; only a derived key is sent. */
export function Auth({
  info,
  onSignedIn,
}: {
  info: ServerInfo;
  onSignedIn: (u: PublicUser) => void;
}) {
  const canSignUp = info.needsSetup || info.signup !== 'closed';
  const [mode, setMode] = useState<'in' | 'up'>(info.needsSetup ? 'up' : 'in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsInvite = mode === 'up' && !info.needsSetup && info.signup === 'invite';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return setError('Enter a username and password.');
    if (mode === 'up' && password.length < 8) return setError('Use at least 8 characters.');
    if (mode === 'up' && password !== confirm) return setError('The passwords don’t match.');
    setBusy(true);
    try {
      const deviceName = `Web · ${navigator.platform || 'browser'}`;
      let res: AuthResponse;
      if (mode === 'in') {
        const pre = await api<PreloginResponse>('/auth/prelogin', { body: { username } });
        const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
        res = await api<AuthResponse>('/auth/login', { body: { username, authKey, deviceName } });
      } else {
        const salt = newSalt();
        const { authKey } = await deriveKeys(password, salt, DEFAULT_KDF);
        res = await api<AuthResponse>('/auth/register', {
          body: {
            username,
            authKey,
            salt,
            kdf: DEFAULT_KDF,
            deviceName,
            invite: invite || undefined,
          },
        });
      }
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--text)]">
      <form
        onSubmit={submit}
        className="w-full max-w-[380px] rounded-[16px] border border-[var(--border)] bg-[var(--bg-solid)] p-7 shadow-sm"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--button)] text-[var(--button-contrast)]">
            <IconRss size={18} />
          </span>
          <div>
            <h1 className="text-[17px] font-bold tracking-tight">Perch</h1>
            <p className="text-[12px] text-[var(--text-faint)]">{location.host}</p>
          </div>
        </div>

        <h2 className="mb-1 text-[15px] font-semibold">
          {info.needsSetup ? 'Set up your server' : mode === 'in' ? 'Sign in' : 'Create an account'}
        </h2>
        {info.needsSetup && (
          <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            No accounts yet. The first one you create here is the admin.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          <input
            className={inputClass}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'up' && (
            <input
              className={inputClass}
              type="password"
              placeholder="Repeat password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {needsInvite && (
            <input
              className={inputClass}
              placeholder="Invite code"
              spellCheck={false}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
          )}
        </div>

        {error && <p className="mt-3 text-[12.5px] text-[#ef4444]">{error}</p>}

        <Button variant="primary" type="submit" loading={busy} className="mt-5 w-full">
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </Button>

        {!info.needsSetup && canSignUp && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in');
              setError(null);
            }}
            className="mt-4 w-full text-center text-[12.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Your password never leaves this browser. Perch derives a key from it and sends only that.
        </p>
      </form>
    </div>
  );
}
