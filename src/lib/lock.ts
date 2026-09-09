import { getSettings, saveSettings } from './storage/settings';

// Optional PIN gate for the reader. This is a *convenience* lock so a passer-by
// can't just open your reading history — NOT real security. The feed data still
// lives unencrypted in local storage / IndexedDB, and anyone with devtools or
// the extension files can read it. We store a salted SHA-256 of the PIN so the
// PIN string itself isn't sitting in settings.

const UNLOCK_KEY = 'perch:unlocked';

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function isPinEnabled(): Promise<boolean> {
  const { pinHash, pinSalt } = await getSettings();
  return Boolean(pinHash && pinSalt);
}

export async function setPin(pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  await saveSettings({ pinSalt: salt, pinHash: await hashPin(pin, salt) });
  markUnlocked();
}

export async function clearPin(): Promise<void> {
  await saveSettings({ pinSalt: undefined, pinHash: undefined });
  markUnlocked();
}

export async function verifyPin(pin: string): Promise<boolean> {
  const { pinHash, pinSalt } = await getSettings();
  if (!pinHash || !pinSalt) return true;
  const ok = (await hashPin(pin, pinSalt)) === pinHash;
  if (ok) markUnlocked();
  return ok;
}

/** Unlock state is per browsing session (per tab/window). */
export function isUnlockedThisSession(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function markUnlocked(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* private mode / storage disabled — the gate will just re-prompt */
  }
}

export function lockNow(): void {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}
