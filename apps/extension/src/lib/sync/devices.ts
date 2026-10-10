import { browser } from 'wxt/browser';
import type { DeviceRecordData } from '@perch/core/sync';
import { getLocal, setLocal, watchLocal } from '../storage/local';

// The devices in this browser's sync chain, as they describe themselves in
// the chain (sealed like every other record). Forgetting one only hides it:
// whoever has the chain's code can still sync.

const DEVICES_KEY = 'perch:chain:devices';
const FORGET_KEY = 'perch:chain:forget';

export type DeviceMap = Record<string, DeviceRecordData>;

export const getDevices = () => getLocal<DeviceMap>(DEVICES_KEY, {});
export const saveDevices = (devices: DeviceMap) => setLocal(DEVICES_KEY, devices);
export const watchDevices = (fn: () => void) => watchLocal(DEVICES_KEY, fn);

/** Device ids to remove from the chain on the next sync. */
export const getForgotten = () => getLocal<string[]>(FORGET_KEY, []);
export const saveForgotten = (ids: string[]) => setLocal(FORGET_KEY, ids);

export async function forgetDevice(id: string): Promise<void> {
  const { [id]: _gone, ...rest } = await getDevices();
  await saveDevices(rest);
  await saveForgotten([...new Set([...(await getForgotten()), id])]);
}

const OS: Record<string, string> = {
  mac: 'macOS',
  win: 'Windows',
  linux: 'Linux',
  cros: 'ChromeOS',
  android: 'Android',
  openbsd: 'OpenBSD',
};

/** How this browser describes itself to the chain's other devices. */
export async function thisDevice(): Promise<DeviceRecordData> {
  const firefox = import.meta.env.BROWSER === 'firefox';
  const ua = globalThis.navigator?.userAgent ?? '';
  const name = firefox ? 'Firefox' : ua.includes('Edg/') ? 'Edge' : 'Chrome';
  const os = await Promise.resolve()
    .then(() => browser.runtime.getPlatformInfo())
    .then((p) => OS[p.os] ?? p.os)
    .catch(() => '');
  return {
    name: os ? `${name} on ${os}` : name,
    platform: firefox ? 'firefox' : 'chrome',
    seenAt: Date.now(),
  };
}
