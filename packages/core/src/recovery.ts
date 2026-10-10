// Recovery codes let someone set a new password without email. The client
// makes one at sign-up and shows it once; the server keeps only its hash.
// 20 characters of Crockford base32 (100 bits), shown in groups of four.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_LENGTH = 20;

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_LENGTH));
  // 256 is a multiple of 32, so taking each byte mod 32 is unbiased.
  const raw = Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
  return formatRecoveryCode(raw);
}

export const formatRecoveryCode = (raw: string) => raw.match(/.{1,4}/g)!.join('-');

/**
 * The canonical form of a code someone typed: upper case, no separators, and
 * the letters people confuse with digits read as those digits. Null when it
 * can't be a code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== RECOVERY_LENGTH) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}
