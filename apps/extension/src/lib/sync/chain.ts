import { API_PREFIX, type ApiError } from '@perch/core/api';
import {
  deriveChainKeys,
  formatChainCode,
  newChainSecret,
  openRecord,
  parseChainCode,
  sealRecord,
  type ChainChangesResponse,
  type ChainCreateResponse,
  type ChainKeys,
  type ChainPushResponse,
} from '@perch/core/chain';
import type {
  StoredRecord,
  SyncChangesResponse,
  SyncPushResponse,
  SyncRecord,
} from '@perch/core/sync';
import { ServerError } from './client';
import type { ChainAccount } from './state';

// Talking to a chain relay. Records are sealed before they leave and opened
// when they arrive, so the engine sees the same shapes as with an account.

const keyCache = new Map<string, Promise<ChainKeys>>();

function keysFor(code: string): Promise<ChainKeys> {
  let keys = keyCache.get(code);
  if (!keys) {
    const secret = parseChainCode(code);
    if (!secret) return Promise.reject(new Error('That isn’t a valid chain code'));
    keys = deriveChainKeys(secret);
    keyCache.set(code, keys);
  }
  return keys;
}

async function call<T>(
  server: string,
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}${API_PREFIX}/chain${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ServerError(0, 'network', `Couldn't reach ${server}`);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ServerError(
      res.status,
      body?.error ?? 'http',
      body?.message ?? `The server answered ${res.status}`,
    );
  }
  return body as T;
}

const randomNode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

/** Starts a new chain on `server`. */
export async function createChain(server: string): Promise<ChainAccount> {
  const code = formatChainCode(newChainSecret());
  const keys = await keysFor(code);
  await call<ChainCreateResponse>(server, '', keys.token, { body: {} });
  return { kind: 'chain', server, code, node: randomNode() };
}

/** Joins the chain with this code; fails if the relay doesn't know it. */
export async function joinChain(server: string, code: string): Promise<ChainAccount> {
  const keys = await keysFor(code);
  await call<ChainChangesResponse>(server, '/changes?since=0&limit=1', keys.token);
  return { kind: 'chain', server, code, node: randomNode() };
}

/** Removes the chain from the relay, for every device in it. */
export async function deleteChain(account: ChainAccount): Promise<void> {
  const keys = await keysFor(account.code);
  await call(account.server, '', keys.token, { method: 'DELETE' });
}

export function chainApi(account: ChainAccount) {
  return {
    async changes(since: number, limit = 500): Promise<SyncChangesResponse> {
      const keys = await keysFor(account.code);
      const page = await call<ChainChangesResponse>(
        account.server,
        `/changes?since=${since}&limit=${limit}`,
        keys.token,
      );
      const opened = await Promise.all(page.records.map((r) => openRecord(keys, r)));
      // A record that won't open came from something other than this chain's
      // devices; skipping it is all we can do.
      const records = opened.filter((r): r is StoredRecord => r !== null);
      if (records.length < opened.length) {
        console.warn(`[sync] ${opened.length - records.length} chain records didn't decrypt`);
      }
      return { records, cursor: page.cursor, more: page.more };
    },

    async push(records: SyncRecord[]): Promise<SyncPushResponse> {
      const keys = await keysFor(account.code);
      const sealed = await Promise.all(records.map((r) => sealRecord(keys, r)));
      const res = await call<ChainPushResponse>(account.server, '/push', keys.token, {
        body: { records: sealed },
      });
      // Results come back in request order; report them by record, not slot.
      return {
        cursor: res.cursor,
        results: res.results.map((result, i) => ({
          ...result,
          key: `${records[i]!.type}:${records[i]!.id}`,
        })),
      };
    },
  };
}
