import { createSHA256 } from 'hash-wasm';

// Proof of work for signing up: the server hands out a signed challenge, and
// the client looks for a nonce whose SHA-256(challenge + ":" + nonce) starts
// with `bits` zero bits. A person waits a second or two once; a script making
// thousands of accounts pays that thousands of times. No third party, no data
// about anyone. It's a speed bump against casual abuse, not a wall.

/** Zero bits at the start of a hash. */
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export const powInput = (challenge: string, nonce: string) => `${challenge}:${nonce}`;

/**
 * Finds a nonce for the challenge. Yields to the event loop now and then so
 * the page stays responsive; `signal` stops it.
 */
export async function solvePow(
  challenge: string,
  bits: number,
  signal?: AbortSignal,
): Promise<string> {
  const sha = await createSHA256();
  for (let n = 0; ; n++) {
    if (n % 20_000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    const nonce = n.toString(36);
    sha.init();
    sha.update(powInput(challenge, nonce));
    if (leadingZeroBits(sha.digest('binary')) >= bits) return nonce;
  }
}

/** The proof a server asks for at sign-up, or undefined when it asks for none. */
export async function proveSignup(
  bits: number | undefined,
  challenge: () => Promise<{ challenge: string; bits: number }>,
  signal?: AbortSignal,
): Promise<{ challenge: string; nonce: string } | undefined> {
  if (!bits) return undefined;
  const c = await challenge();
  return { challenge: c.challenge, nonce: await solvePow(c.challenge, c.bits, signal) };
}
