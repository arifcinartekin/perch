import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** URL-safe random token. 32 bytes = 256 bits. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

export const hmac = (key: string, value: string) =>
  createHmac('sha256', key).update(value).digest();

// The client already stretched the password with Argon2id, so the auth key is
// high-entropy. This second hash only makes a leaked database useless as login
// material; modest scrypt parameters are plenty.
const SCRYPT = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashAuthKey(authKey: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(authKey, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyAuthKey(authKey: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(authKey, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

/** A hash that always takes as long as a real verification, for unknown users. */
export const DUMMY_AUTH_HASH = await hashAuthKey(randomToken());
