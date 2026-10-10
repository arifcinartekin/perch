import { useState } from 'react';
import type {
  AuthResponse,
  EmailPurpose,
  PowChallenge,
  PreloginResponse,
  PublicUser,
  ServerInfo,
} from '@perch/core/api';
import { DEFAULT_KDF, deriveKeys, newSalt } from '@perch/core/auth';
import { proveSignup } from '@perch/core/pow';
import { newRecoveryCode } from '@perch/core/recovery';
import { suggestUsername } from '@perch/core/username';
import { Button, PerchLogo, RecoveryCode } from '@perch/reader';
import { ServerError, api } from './api';

const inputClass =
  'w-full rounded-[9px] border border-[var(--border-strong)] bg-[var(--bg-solid)] px-3 py-2 text-[14px] outline-none focus:border-[var(--accent)]';

const linkClass =
  'mt-3 w-full text-center text-[12.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]';

/** Sign in or create an account. The password is stretched here; only a derived key is sent. */
export function Auth({
  info,
  onSignedIn,
}: {
  info: ServerInfo;
  onSignedIn: (u: PublicUser) => void;
}) {
  const canSignUp = info.needsSetup || info.signup !== 'closed';
  // 'reset' sets a new password with an emailed code, 'recover' with the recovery code.
  const [mode, setMode] = useState<'in' | 'up' | 'reset' | 'recover'>(
    info.needsSetup ? 'up' : 'in',
  );
  // Email signup and password reset start by mailing a code; `sentTo` is set once it's sent.
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  // A new account's recovery code, shown once before going in.
  const [created, setCreated] = useState<{ user: PublicUser; code: string } | null>(null);
  const [busy, setBusy] = useState<false | 'work' | true>(false);
  const [error, setError] = useState<string | null>(null);
  const needsInvite = mode === 'up' && !info.needsSetup && info.signup === 'invite';
  const purpose: EmailPurpose | null =
    mode === 'reset' ? 'reset' : mode === 'up' && info.signup === 'email' ? 'signup' : null;
  const askingEmail = purpose != null && sentTo == null;

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setSentTo(null);
    setCode('');
    setError(null);
  };

  const sendCode = async () => {
    if (!email.trim()) return setError('Enter your email address.');
    setBusy(true);
    try {
      await api('/auth/email/code', {
        body: { email: email.trim(), purpose, lang: navigator.language },
      });
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (askingEmail) return sendCode();
    const isNew = mode !== 'in';
    if (purpose && !code.trim()) return setError('Enter the code from the email.');
    if ((mode !== 'reset' && !username.trim()) || !password) {
      return setError(
        mode === 'reset' ? 'Enter a new password.' : 'Enter a username and password.',
      );
    }
    if (mode === 'recover' && !recoveryInput.trim()) return setError('Enter your recovery code.');
    if (isNew && password.length < 8) return setError('Use at least 8 characters.');
    if (isNew && password !== confirm) return setError('The passwords don’t match.');
    setBusy(true);
    try {
      const deviceName = `Web · ${navigator.platform || 'browser'}`;
      let res: AuthResponse;
      if (mode === 'in') {
        const pre = await api<PreloginResponse>('/auth/prelogin', { body: { username } });
        const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
        res = await api<AuthResponse>('/auth/login', { body: { username, authKey, deviceName } });
      } else if (mode === 'recover') {
        const salt = newSalt();
        const { authKey } = await deriveKeys(password, salt, DEFAULT_KDF);
        res = await api<AuthResponse>('/auth/recover', {
          body: {
            username,
            recoveryCode: recoveryInput,
            authKey,
            salt,
            kdf: DEFAULT_KDF,
            deviceName,
          },
        });
      } else if (mode === 'reset') {
        const salt = newSalt();
        const { authKey } = await deriveKeys(password, salt, DEFAULT_KDF);
        res = await api<AuthResponse>('/auth/reset', {
          body: { email: sentTo, code, authKey, salt, kdf: DEFAULT_KDF, deviceName },
        });
      } else {
        const salt = newSalt();
        const recoveryCode = info.recovery ? newRecoveryCode() : undefined;
        setBusy('work');
        const [{ authKey }, pow] = await Promise.all([
          deriveKeys(password, salt, DEFAULT_KDF),
          info.needsSetup
            ? undefined
            : proveSignup(info.pow, () => api<PowChallenge>('/auth/challenge')),
        ]);
        res = await api<AuthResponse>('/auth/register', {
          body: {
            username,
            authKey,
            salt,
            kdf: DEFAULT_KDF,
            deviceName,
            invite: invite || undefined,
            pow,
            recoveryCode,
            ...(purpose && { email: sentTo, emailCode: code }),
          },
        });
        if (recoveryCode) return setCreated({ user: res.user, code: recoveryCode });
      }
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-[var(--text)]">
        <div className="glass w-full max-w-[380px] rounded-[22px] p-7">
          <h2 className="mb-3 text-[15px] font-semibold">Save your recovery code</h2>
          <RecoveryCode
            code={created.code}
            username={created.user.username}
            host={location.host}
            onDone={() => onSignedIn(created.user)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-[var(--text)]">
      <form onSubmit={submit} className="glass w-full max-w-[380px] rounded-[22px] p-7">
        <div className="mb-6">
          <h1>
            <PerchLogo height={40} />
          </h1>
          <p className="mt-1.5 text-[12px] text-[var(--text-faint)]">{location.host}</p>
        </div>

        <h2 className="mb-1 text-[15px] font-semibold">
          {info.needsSetup
            ? 'Set up your server'
            : mode === 'in'
              ? 'Sign in'
              : mode === 'reset' || mode === 'recover'
                ? 'Reset your password'
                : 'Create an account'}
        </h2>
        {info.needsSetup && (
          <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            No accounts yet. The first one you create here is the admin.
          </p>
        )}

        {askingEmail ? (
          <div className="mt-4 flex flex-col gap-2.5">
            <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
              {mode === 'reset'
                ? 'We’ll email you a code to set a new password.'
                : 'We’ll email you a code to confirm your address.'}
            </p>
            <input
              className={inputClass}
              type="email"
              placeholder="Email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2.5">
            {sentTo && (
              <>
                <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                  We sent a 6-digit code to <b className="text-[var(--text)]">{sentTo}</b>. It works
                  for 10 minutes.
                </p>
                <input
                  className={inputClass}
                  placeholder="Code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </>
            )}
            {mode === 'recover' && (
              <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                Enter your username, the recovery code you saved when you made the account, and a
                new password.
              </p>
            )}
            {mode !== 'reset' && (
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Username"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus={!sentTo}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                {mode === 'up' && (
                  <Button
                    variant="default"
                    type="button"
                    title="Suggest a username"
                    onClick={() => setUsername(suggestUsername())}
                  >
                    Suggest
                  </Button>
                )}
              </div>
            )}
            {mode === 'up' && (
              <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                Your username is shown on notes you share. Don’t use your real name or anything that
                identifies you.
              </p>
            )}
            {mode === 'recover' && (
              <input
                className={inputClass}
                placeholder="Recovery code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
              />
            )}
            <input
              className={inputClass}
              type="password"
              placeholder={mode === 'reset' || mode === 'recover' ? 'New password' : 'Password'}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'in' && (
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
        )}

        {error && <p className="mt-3 text-[12.5px] text-[#ef4444]">{error}</p>}

        <Button variant="primary" type="submit" loading={!!busy} className="mt-5 w-full">
          {askingEmail
            ? 'Send code'
            : mode === 'in'
              ? 'Sign in'
              : mode === 'reset' || mode === 'recover'
                ? 'Set new password'
                : 'Create account'}
        </Button>
        {busy === 'work' && (
          <p className="mt-2 text-center text-[11.5px] text-[var(--text-faint)]">
            Your browser is doing a moment of work to show it isn’t a bot…
          </p>
        )}

        {sentTo && (
          <button type="button" onClick={() => switchMode(mode)} className={linkClass}>
            Use a different address or send a new code
          </button>
        )}
        {mode === 'in' && (info.email || info.recovery) && (
          <button
            type="button"
            onClick={() => switchMode(info.email ? 'reset' : 'recover')}
            className={linkClass}
          >
            Forgot your password?
          </button>
        )}
        {mode === 'reset' && info.recovery && (
          <button type="button" onClick={() => switchMode('recover')} className={linkClass}>
            Use your recovery code instead
          </button>
        )}
        {mode === 'recover' && info.email && (
          <button type="button" onClick={() => switchMode('reset')} className={linkClass}>
            Get a code by email instead
          </button>
        )}
        {!info.needsSetup && (canSignUp || mode === 'reset' || mode === 'recover') && (
          <button
            type="button"
            onClick={() => switchMode(mode === 'in' ? 'up' : 'in')}
            className={linkClass}
          >
            {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          Your password never leaves this browser. Perch derives a key from it and sends only that.
        </p>
        {mode === 'up' && info.legal && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
            By creating an account you agree to the{' '}
            {info.legal.terms && (
              <a
                href={info.legal.terms}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                terms
              </a>
            )}
            {info.legal.terms && info.legal.privacy && ' and '}
            {info.legal.privacy && (
              <a
                href={info.legal.privacy}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                privacy policy
              </a>
            )}
            .
          </p>
        )}
      </form>
    </div>
  );
}
