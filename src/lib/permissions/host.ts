import { browser } from 'wxt/browser';
import { originPattern } from '../util/url';

// Runtime host-permission helpers. Perch never holds standing host access; it
// asks for the narrowest origin it needs, when it needs it, from a user gesture.

export const ALL_SITES = '*://*/*';

export { originPattern };

export async function hasHostPermission(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (click). Returns whether it was granted. */
export async function requestHostPermission(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  try {
    return await browser.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function removeHostPermission(url: string): Promise<void> {
  const pattern = originPattern(url);
  if (!pattern) return;
  try {
    await browser.permissions.remove({ origins: [pattern] });
  } catch {
    /* ignore */
  }
}

export async function hasAllSites(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [ALL_SITES] });
  } catch {
    return false;
  }
}

export async function requestAllSites(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [ALL_SITES] });
  } catch {
    return false;
  }
}

export async function removeAllSites(): Promise<void> {
  try {
    await browser.permissions.remove({ origins: [ALL_SITES] });
  } catch {
    /* ignore */
  }
}

/** Fires whenever the set of granted permissions changes (any context). */
export function onPermissionsChanged(handler: () => void): () => void {
  browser.permissions.onAdded.addListener(handler);
  browser.permissions.onRemoved.addListener(handler);
  return () => {
    browser.permissions.onAdded.removeListener(handler);
    browser.permissions.onRemoved.removeListener(handler);
  };
}
