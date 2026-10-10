import { createHash, timingSafeEqual } from 'node:crypto';
import type { PowChallenge, PowSolution } from '@perch/core/api';
import { leadingZeroBits, powInput } from '@perch/core/pow';
import { HttpError } from '../http';
import { hmac, randomToken } from '../lib/crypto';

// Signed, short-lived challenges for the sign-up proof of work. Nothing is
// stored to hand one out; a solved challenge is remembered (in memory) until
// it expires, so one solution makes one account.

const TTL_MS = 10 * 60 * 1000;

export class PowGate {
  private used = new Map<string, number>();

  constructor(
    private readonly secret: string,
    readonly bits: number,
  ) {}

  issue(now = Date.now()): PowChallenge {
    const body = `${now + TTL_MS}.${randomToken(12)}`;
    return { challenge: `${body}.${this.sign(body)}`, bits: this.bits };
  }

  /** Throws unless the solution is for a live challenge of ours, unused, and hard enough. */
  check(solution: unknown, now = Date.now()): void {
    const s = solution as Partial<PowSolution> | undefined;
    if (typeof s?.challenge !== 'string' || typeof s.nonce !== 'string' || s.nonce.length > 32) {
      throw new HttpError(400, 'pow-required', 'This server asks for a proof of work to sign up');
    }
    const [expires, random, sig] = s.challenge.split('.');
    const body = `${expires}.${random}`;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig ?? '');
    const genuine = expected.length === given.length && timingSafeEqual(expected, given);
    if (!genuine || !(Number(expires) > now) || this.used.has(s.challenge)) {
      throw new HttpError(400, 'pow-invalid', 'That proof of work has expired; try again');
    }
    const hash = createHash('sha256').update(powInput(s.challenge, s.nonce)).digest();
    if (leadingZeroBits(hash) < this.bits) {
      throw new HttpError(400, 'pow-invalid', 'That proof of work is not right; try again');
    }
    this.used.set(s.challenge, Number(expires));
    if (this.used.size > 10_000) {
      for (const [key, exp] of this.used) if (exp <= now) this.used.delete(key);
    }
  }

  private sign(body: string) {
    return hmac(this.secret, `pow:${body}`).subarray(0, 16).toString('base64url');
  }
}
