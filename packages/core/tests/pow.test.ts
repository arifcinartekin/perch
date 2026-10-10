import { createHash } from 'node:crypto';
import { leadingZeroBits, powInput, solvePow } from '../src/pow';
import { formatRecoveryCode, newRecoveryCode, normalizeRecoveryCode } from '../src/recovery';

describe('proof of work', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x80]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array([0x0f]))).toBe(4);
    expect(leadingZeroBits(new Uint8Array([0, 1]))).toBe(15);
  });

  it('finds a nonce the server can check with plain SHA-256', async () => {
    const nonce = await solvePow('challenge', 12);
    const hash = createHash('sha256').update(powInput('challenge', nonce)).digest();
    expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(12);
  });
});

describe('recovery codes', () => {
  it('are 20 characters in groups of four', () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/);
    expect(newRecoveryCode()).not.toBe(code);
  });

  it('read what people type', () => {
    const code = newRecoveryCode();
    const raw = code.replace(/-/g, '');
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(raw);
    expect(normalizeRecoveryCode(` ${raw.slice(0, 10)} ${raw.slice(10)} `)).toBe(raw);
    expect(normalizeRecoveryCode('OOOO-IIII-LLLL-0000-1111')).toBe('00001111111100001111');
    expect(normalizeRecoveryCode('too short')).toBeNull();
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU-UUUU-UUUU')).toBeNull();
    expect(formatRecoveryCode(raw)).toBe(code);
  });
});

describe('suggested usernames', async () => {
  const { normalizeUsername, suggestUsername, usernameProblem } = await import('../src/username');
  it('are valid and vary', () => {
    const names = new Set(Array.from({ length: 50 }, suggestUsername));
    for (const name of names) {
      expect(normalizeUsername(name)).toBe(name);
      expect(usernameProblem(name)).toBeNull();
    }
    expect(names.size).toBeGreaterThan(40);
  });
});
