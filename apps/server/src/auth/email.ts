import { randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { EmailPurpose } from '@perch/core/api';
import type { DB } from '../db';
import { emailCodes } from '../db/schema';
import { HttpError, badRequest } from '../http';
import { hmac } from '../lib/crypto';
import type { Email } from '../lib/mailer';

// Emailed 6-digit codes prove someone can read an address: before signing up,
// resetting a password, or adding the address to an account. Codes live ten
// minutes, allow five guesses, and only their HMAC is stored.

// Addresses are never stored. Where the server needs to recognise one (the
// account it belongs to, the code sent to it) it keeps an emailId: scrypt of
// the address keyed with PERCH_EMAIL_KEY. Someone holding the database can't
// read or list addresses, and testing guesses costs them real work per guess.
// The address itself is used only to send the email, then forgotten.

const ID_PARAMS = { N: 2 ** 14, r: 8, p: 1 };

export function emailId(key: string, email: string): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(email, `perch-email:${key}`, 32, ID_PARAMS, (err, out) =>
      err ? reject(err) : resolve(out.toString('base64url')),
    ),
  );
}

export const emailIdSync = (key: string, email: string) =>
  scryptSync(email, `perch-email:${key}`, 32, ID_PARAMS).toString('base64url');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    throw new HttpError(400, 'email-invalid', 'That email address is not valid');
  }
  return email;
}

const hashCode = (secret: string, id: string, purpose: EmailPurpose, code: string) =>
  hmac(secret, `email-code:${purpose}:${id}:${code}`).toString('base64url');

/** Make a new code for this address (by emailId) and purpose, replacing any earlier one. */
export function issueCode(db: DB, secret: string, id: string, purpose: EmailPurpose): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  db.delete(emailCodes).where(lt(emailCodes.expiresAt, now)).run();
  const row = {
    emailId: id,
    purpose,
    codeHash: hashCode(secret, id, purpose, code),
    attempts: 0,
    expiresAt: now + CODE_TTL_MS,
    createdAt: now,
  };
  db.insert(emailCodes)
    .values(row)
    .onConflictDoUpdate({ target: [emailCodes.emailId, emailCodes.purpose], set: row })
    .run();
  return code;
}

const invalidCode = () =>
  new HttpError(400, 'email-code-invalid', 'That code is wrong or has expired');

/**
 * Check a code without using it up. A wrong guess counts against the code;
 * the last allowed wrong guess deletes it. Call `consumeCode` in the same
 * transaction as the change the code authorises.
 */
export function checkCode(
  db: DB,
  secret: string,
  id: string,
  purpose: EmailPurpose,
  code: string,
): void {
  if (!/^\d{6}$/.test(code)) throw invalidCode();
  const where = and(eq(emailCodes.emailId, id), eq(emailCodes.purpose, purpose));
  const row = db.select().from(emailCodes).where(where).get();
  if (!row || row.expiresAt <= Date.now()) throw invalidCode();
  const expected = Buffer.from(row.codeHash);
  const actual = Buffer.from(hashCode(secret, id, purpose, code));
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return;
  if (row.attempts + 1 >= MAX_ATTEMPTS) db.delete(emailCodes).where(where).run();
  else
    db.update(emailCodes)
      .set({ attempts: sql`${emailCodes.attempts} + 1` })
      .where(where)
      .run();
  throw invalidCode();
}

/** Use up a code `checkCode` accepted. Fails if another request used it first. */
export function consumeCode(
  db: Pick<DB, 'delete'>,
  secret: string,
  id: string,
  purpose: EmailPurpose,
  code: string,
): void {
  const used = db
    .delete(emailCodes)
    .where(
      and(
        eq(emailCodes.emailId, id),
        eq(emailCodes.purpose, purpose),
        eq(emailCodes.codeHash, hashCode(secret, id, purpose, code)),
      ),
    )
    .returning({ id: emailCodes.emailId })
    .get();
  if (!used) throw invalidCode();
}

export function emailCodeFrom(body: Record<string, unknown>, key = 'code'): string {
  const v = body[key];
  if (typeof v !== 'string') throw badRequest(`"${key}" must be a string`);
  return v.replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Lang = 'en' | 'tr';
export const emailLang = (v: unknown): Lang =>
  typeof v === 'string' && v.toLowerCase().startsWith('tr') ? 'tr' : 'en';

const MESSAGES = {
  en: {
    signup: ['Your Perch sign-up code', 'Your code to create a Perch account on {host}:'],
    reset: ['Your Perch password reset code', 'Your code to reset your Perch password on {host}:'],
    change: [
      'Confirm your email for Perch',
      'Your code to add this address to your Perch account on {host}:',
    ],
    expiry: 'It works for 10 minutes. If you didn’t ask for it, you can ignore this email.',
    taken: [
      'You already have a Perch account',
      'Someone, probably you, tried to sign up on {host} with this address, but it already belongs to an account. To get back in, use “Forgot password” on the sign-in screen.',
    ],
    inUse: [
      'This address is already in use on Perch',
      'Someone tried to add this address to an account on {host}, but it already belongs to another account. If that wasn’t you, you can ignore this email.',
    ],
  },
  tr: {
    signup: ['Perch kayıt kodun', '{host} üzerinde Perch hesabı açmak için kodun:'],
    reset: [
      'Perch şifre sıfırlama kodun',
      '{host} üzerindeki Perch şifreni sıfırlamak için kodun:',
    ],
    change: [
      'Perch için e-postanı doğrula',
      'Bu adresi {host} üzerindeki Perch hesabına eklemek için kodun:',
    ],
    expiry: 'Kod 10 dakika geçerli. Bunu sen istemediysen bu e-postayı yok sayabilirsin.',
    taken: [
      'Zaten bir Perch hesabın var',
      'Biri, büyük ihtimalle sen, {host} üzerinde bu adresle kayıt olmaya çalıştı ama adres zaten bir hesaba ait. Hesabına dönmek için giriş ekranındaki “Şifremi unuttum”u kullan.',
    ],
    inUse: [
      'Bu adres Perch’te zaten kullanılıyor',
      'Biri bu adresi {host} üzerindeki bir hesaba eklemeye çalıştı ama adres başka bir hesaba ait. Bu sen değilsen bu e-postayı yok sayabilirsin.',
    ],
  },
} as const;

export function codeEmail(
  to: string,
  purpose: EmailPurpose,
  code: string,
  lang: Lang,
  host: string,
): Email {
  const m = MESSAGES[lang];
  const [subject, intro] = m[purpose];
  return {
    to,
    subject: `${subject}: ${code}`,
    text: `${intro.replace('{host}', host)}\n\n    ${code}\n\n${m.expiry}\n`,
  };
}

export function noticeEmail(to: string, kind: 'taken' | 'inUse', lang: Lang, host: string): Email {
  const [subject, body] = MESSAGES[lang][kind];
  return { to, subject, text: `${body.replace('{host}', host)}\n` };
}
