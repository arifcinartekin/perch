import { argon2id } from 'hash-wasm';

// Client-side password stretching. The password never leaves the device:
// clients run Argon2id with the account's salt, split the result with HKDF, and
// send only the auth key. The server hashes that again before storing it. The
// other half (the master key) is reserved for unlocking the E2E vault.

export interface KdfParams {
  algorithm: 'argon2id';
  /** Memory in KiB. */
  memory: number;
  iterations: number;
  parallelism: number;
}

/** OWASP's first Argon2id recommendation: 64 MiB, 3 passes. ~0.5 s on a phone. */
export const DEFAULT_KDF: KdfParams = {
  algorithm: 'argon2id',
  memory: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

/** Bounds a server accepts, so a client can't register with a trivially weak KDF. */
export const KDF_LIMITS = {
  memory: { min: 8 * 1024, max: 1024 * 1024 },
  iterations: { min: 1, max: 10 },
  parallelism: { min: 1, max: 4 },
} as const;

export function isValidKdf(value: unknown): value is KdfParams {
  if (!value || typeof value !== 'object') return false;
  const k = value as Record<string, unknown>;
  const within = (n: unknown, r: { min: number; max: number }) =>
    Number.isInteger(n) && (n as number) >= r.min && (n as number) <= r.max;
  return (
    k.algorithm === 'argon2id' &&
    within(k.memory, KDF_LIMITS.memory) &&
    within(k.iterations, KDF_LIMITS.iterations) &&
    within(k.parallelism, KDF_LIMITS.parallelism)
  );
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A fresh 16-byte salt for a new account, base64url. */
export function newSalt(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export interface DerivedKeys {
  /** Sent to the server in place of the password (base64url, 32 bytes). */
  authKey: string;
  /** Never leaves the device. Wraps the vault key in E2E mode. */
  masterKey: Uint8Array;
}

async function hkdf(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as Uint8Array<ArrayBuffer>, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveKeys(
  password: string,
  salt: string,
  params: KdfParams = DEFAULT_KDF,
): Promise<DerivedKeys> {
  const stretched = await argon2id({
    password: password.normalize('NFKC'),
    salt: fromBase64Url(salt),
    memorySize: params.memory,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  const [auth, master] = await Promise.all([
    hkdf(stretched, 'perch/auth/v1'),
    hkdf(stretched, 'perch/master/v1'),
  ]);
  return { authKey: toBase64Url(auth), masterKey: master };
}
