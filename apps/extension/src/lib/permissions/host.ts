import { browser } from 'wxt/browser';
import { originPattern } from '@perch/core/url';

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

/**
 * What Perch sends, and only once you turn it on, in Firefox's terms
 * (data_collection_permissions in wxt.config.ts). Asked for together with
 * the server's origin, in the same prompt.
 */
export const DATA_FOR = {
  /** A sync chain: your library, sealed, to the relay. */
  chain: ['browsingActivity', 'websiteContent'],
  /** An account on a Perch Server that keeps your library. */
  server: ['authenticationInfo', 'personallyIdentifyingInfo', 'browsingActivity', 'websiteContent'],
  /** A Perch account, for sharing notes. */
  community: ['authenticationInfo', 'personallyIdentifyingInfo', 'websiteContent'],
} as const;

/**
 * Must be called from a user gesture (click). Returns whether it was granted.
 * In Firefox, `dataCollection` asks in the same prompt to send that data.
 */
export async function requestHostPermission(
  url: string,
  dataCollection?: readonly string[],
): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  const firefox = import.meta.env.BROWSER === 'firefox';
  try {
    return await browser.permissions.request({
      origins: [pattern],
      ...(firefox && dataCollection && { data_collection: [...dataCollection] }),
    } as Parameters<typeof browser.permissions.request>[0]);
  } catch {
    // A Firefox too old for data collection permissions: ask for the origin alone.
    if (firefox && dataCollection) return requestHostPermission(url);
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
