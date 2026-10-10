import { API_PREFIX } from '@perch/core/api';
import type {
  ApiError,
  AuthResponse,
  EmailPurpose,
  PowChallenge,
  PreloginResponse,
  ServerInfo,
  ShareResponse,
} from '@perch/core/api';
import { DEFAULT_KDF, deriveKeys, newSalt } from '@perch/core/auth';
import { proveSignup } from '@perch/core/pow';
import { newRecoveryCode } from '@perch/core/recovery';
import type { SyncChangesResponse, SyncPushResponse, SyncRecord } from '@perch/core/sync';
import type { ServerAccount } from './state';

// HTTP calls to a Perch Server. The extension page that signs in needs host
// permission for the server's origin; that's also what lets these requests
// skip CORS.

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

/** "reader.example.com" → "https://reader.example.com". Throws on nonsense. */
export function normalizeServerUrl(input: string): string {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http(s) URL');
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}`;
}

async function call<T>(
  server: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}${API_PREFIX}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
        ...(init.token && { authorization: `Bearer ${init.token}` }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ServerError(0, 'network', `Couldn't reach ${server}`);
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ServerError(
      res.status,
      body?.error ?? 'http',
      body?.message ?? `The server answered ${res.status}`,
    );
  }
  return body as T;
}

export async function getServerInfo(server: string): Promise<ServerInfo> {
  const info = await call<ServerInfo>(server, '/server');
  if (info?.software !== 'perch-server') {
    throw new ServerError(0, 'not-perch', `${server} doesn't look like a Perch Server`);
  }
  return info;
}

const deviceName = () => `Perch extension (${import.meta.env.BROWSER ?? 'browser'})`;
const randomNode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

export async function signIn(
  server: string,
  username: string,
  password: string,
): Promise<ServerAccount> {
  const pre = await call<PreloginResponse>(server, '/auth/prelogin', { body: { username } });
  const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
  const res = await call<AuthResponse>(server, '/auth/login', {
    body: { username, authKey, deviceName: deviceName() },
  });
  return { server, username: res.user.username, token: res.token, node: randomNode() };
}

/**
 * Creates an account. When the server takes recovery codes, one is made here
 * and returned to show the person once; any proof of work it asks for is done
 * here too.
 */
export async function signUp(
  server: string,
  username: string,
  password: string,
  info: Pick<ServerInfo, 'pow' | 'recovery' | 'needsSetup'>,
  extra: { invite?: string; email?: string; emailCode?: string } = {},
): Promise<{ account: ServerAccount; recoveryCode?: string }> {
  const salt = newSalt();
  const recoveryCode = info.recovery ? newRecoveryCode() : undefined;
  const [{ authKey }, pow] = await Promise.all([
    deriveKeys(password, salt, DEFAULT_KDF),
    info.needsSetup
      ? undefined
      : proveSignup(info.pow, () => call<PowChallenge>(server, '/auth/challenge')),
  ]);
  const res = await call<AuthResponse>(server, '/auth/register', {
    body: {
      username,
      authKey,
      salt,
      kdf: DEFAULT_KDF,
      deviceName: deviceName(),
      pow,
      recoveryCode,
      ...(extra.invite && { invite: extra.invite }),
      ...(extra.email && { email: extra.email, emailCode: extra.emailCode }),
    },
  });
  return {
    account: { server, username: res.user.username, token: res.token, node: randomNode() },
    recoveryCode,
  };
}

/** Set a new password with the recovery code; signs in as the account. */
export async function recoverAccount(
  server: string,
  username: string,
  recoveryCode: string,
  password: string,
): Promise<ServerAccount> {
  const salt = newSalt();
  const { authKey } = await deriveKeys(password, salt, DEFAULT_KDF);
  const res = await call<AuthResponse>(server, '/auth/recover', {
    body: { username, recoveryCode, authKey, salt, kdf: DEFAULT_KDF, deviceName: deviceName() },
  });
  return { server, username: res.user.username, token: res.token, node: randomNode() };
}

/** Email a 6-digit code for signing up or resetting the password. */
export async function requestEmailCode(
  server: string,
  email: string,
  purpose: EmailPurpose,
): Promise<void> {
  await call(server, '/auth/email/code', {
    body: { email, purpose, lang: navigator.language },
  });
}

/** Set a new password with an emailed code; signs in as the account. */
export async function resetPassword(
  server: string,
  email: string,
  code: string,
  password: string,
): Promise<ServerAccount> {
  const salt = newSalt();
  const { authKey } = await deriveKeys(password, salt, DEFAULT_KDF);
  const res = await call<AuthResponse>(server, '/auth/reset', {
    body: { email, code, authKey, salt, kdf: DEFAULT_KDF, deviceName: deviceName() },
  });
  return { server, username: res.user.username, token: res.token, node: randomNode() };
}

export async function signOutRemote(account: ServerAccount): Promise<void> {
  await call(account.server, '/auth/logout', { token: account.token, body: {} }).catch(() => {});
}

/** Delete the account on the server and everything stored there with it. */
export async function deleteAccount(account: ServerAccount, password: string): Promise<void> {
  const pre = await call<PreloginResponse>(account.server, '/auth/prelogin', {
    body: { username: account.username },
  });
  const { authKey } = await deriveKeys(password, pre.salt, pre.kdf);
  await call(account.server, '/auth/delete', { token: account.token, body: { authKey } });
}

/** Publish a note (already synced to the server) as a public page. */
export async function shareNote(account: ServerAccount, noteId: string): Promise<string> {
  const res = await call<ShareResponse>(account.server, `/shares/${encodeURIComponent(noteId)}`, {
    method: 'PUT',
    token: account.token,
    body: {},
  });
  return res.url;
}

export async function unshareNote(account: ServerAccount, noteId: string): Promise<void> {
  await call(account.server, `/shares/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    token: account.token,
  });
}

export function syncApi(account: ServerAccount) {
  const token = account.token;
  return {
    changes: (since: number, limit = 500) =>
      call<SyncChangesResponse>(account.server, `/sync/changes?since=${since}&limit=${limit}`, {
        token,
      }),
    push: (records: SyncRecord[]) =>
      call<SyncPushResponse>(account.server, '/sync/push', { token, body: { records } }),
  };
}
