import { stateRecordId, type StateRecordData } from '@perch/core/sync';
import type { Article } from '@perch/core/types';
import { getLocal, setLocal, watchLocal } from '../storage/local';

// Device-local sync bookkeeping, in storage.local. None of it is itself synced.

export const SYNC_KEYS = {
  account: 'perch:sync:account',
  status: 'perch:sync:status',
  /** recordKey → canonical JSON of the value last agreed with the server. */
  shadow: 'perch:sync:shadow',
  /** State record id → read/starred changed here and not pushed yet. */
  outbox: 'perch:sync:outbox',
} as const;

/** Signed in to an account on a Perch Server. */
export interface ServerAccount {
  /** Absent on accounts saved before chains existed. */
  kind?: 'server';
  /** Server origin, e.g. "https://reader.example.com". */
  server: string;
  username: string;
  token: string;
  /** This device's clock id; random, stable while signed in. */
  node: string;
}

/** In a sync chain (no account): records go through a relay, encrypted. */
export interface ChainAccount {
  kind: 'chain';
  /** The relay's origin, e.g. "https://sync.perch.ws". */
  server: string;
  /** The chain's code; everything else is derived from it. */
  code: string;
  node: string;
}

export type SyncAccount = ServerAccount | ChainAccount;

export const isChain = (account: SyncAccount): account is ChainAccount => account.kind === 'chain';

export interface SyncStatus {
  /** Highest server version applied here. */
  cursor: number;
  lastSyncAt?: number;
  lastError?: string;
  /** The account's session was revoked; signing in again is needed. */
  signedOut?: boolean;
  /** Last clock value, so the device clock stays monotonic across restarts. */
  hlc?: string;
}

export type Shadow = Record<string, string>;
export type Outbox = Record<string, StateRecordData>;

export const getAccount = () => getLocal<SyncAccount | null>(SYNC_KEYS.account, null);
export const getStatus = () => getLocal<SyncStatus>(SYNC_KEYS.status, { cursor: 0 });
export const getShadow = () => getLocal<Shadow>(SYNC_KEYS.shadow, {});
export const getOutbox = () => getLocal<Outbox>(SYNC_KEYS.outbox, {});

export async function setStatus(patch: Partial<SyncStatus>): Promise<SyncStatus> {
  const next = { ...(await getStatus()), ...patch };
  await setLocal(SYNC_KEYS.status, next);
  return next;
}

export const saveShadow = (shadow: Shadow) => setLocal(SYNC_KEYS.shadow, shadow);
export const saveOutbox = (outbox: Outbox) => setLocal(SYNC_KEYS.outbox, outbox);

export async function saveAccount(account: SyncAccount): Promise<void> {
  // A new account starts from scratch: everything is pulled, then merged.
  await setLocal(SYNC_KEYS.status, { cursor: 0 } satisfies SyncStatus);
  await setLocal(SYNC_KEYS.shadow, {});
  await setLocal(SYNC_KEYS.outbox, {});
  await setLocal(SYNC_KEYS.account, account);
}

export async function clearAccount(): Promise<void> {
  await setLocal(SYNC_KEYS.account, null);
  await setLocal(SYNC_KEYS.status, { cursor: 0 } satisfies SyncStatus);
  await setLocal(SYNC_KEYS.shadow, {});
  await setLocal(SYNC_KEYS.outbox, {});
}

/**
 * Queue read/starred changes made on this device. Called after every local
 * state change; a no-op when sync is off.
 */
export async function queueStateChanges(
  articles: Pick<Article, 'id' | 'feedId' | 'read' | 'starred'>[],
): Promise<void> {
  if (articles.length === 0 || !(await getAccount())) return;
  const outbox = await getOutbox();
  for (const a of articles) {
    outbox[stateRecordId(a.feedId, a.id)] = { read: a.read === 1, starred: a.starred === 1 };
  }
  await saveOutbox(outbox);
}

export function watchSync(onChange: () => void): () => void {
  const stops = [SYNC_KEYS.account, SYNC_KEYS.status].map((key) => watchLocal(key, onChange));
  return () => stops.forEach((stop) => stop());
}
