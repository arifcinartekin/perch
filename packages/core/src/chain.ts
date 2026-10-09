import { fromBase64Url, toBase64Url } from './auth';
import {
  recordKey,
  type PushStatus,
  type RecordDataMap,
  type RecordType,
  type StoredRecord,
  type SyncRecord,
} from './sync';

// Sync chains: sync without an account. One device makes a random secret and
// shows it as a code (and a QR); every device that enters it joins the chain.
// The relay only ever sees records it can't read:
//
//   secret ──HKDF──┬─ token  sent as the bearer token; the relay keeps its hash
//                  ├─ enc    AES-256-GCM key for record contents
//                  └─ mac    HMAC key that turns "feed:<id>" into an opaque slot
//
// Slots keep the protocol's last-writer-wins per record working (the relay
// compares clocks per slot) without telling it which feeds you follow: feed ids
// are short hashes of URLs, so in the clear they could be guessed back.
// The clock, a deleted flag and an "ephemeral" hint (read, unstarred state the
// relay may forget after a while) are all it learns about a record.
//
// The Swift port is apps/ios/PerchKit/Sources/PerchKit/Chain.swift; the test
// vectors in tests/chain.test.ts pin both.

/** The relay a new chain uses unless you pick another. */
export const DEFAULT_CHAIN_SERVER = 'https://sync.perch.ws';

const SECRET_BYTES = 16;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 16 secret bytes + 1 check byte = 136 bits → 28 base-32 characters. */
const CODE_LENGTH = 28;
const HKDF_SALT = new TextEncoder().encode('perch-chain-v1');

// ---------------------------------------------------------------------------
// The code
// ---------------------------------------------------------------------------

export function newChainSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

/** CRC-8 (polynomial 0x07): catches a mistyped or swapped character. */
function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** "7GQ2-M4XD-…": seven groups of four, Crockford base 32. */
export function formatChainCode(secret: Uint8Array): string {
  if (secret.length !== SECRET_BYTES) throw new Error('A chain secret is 16 bytes');
  const bytes = new Uint8Array([...secret, crc8(secret)]);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{4}/g)!.join('-');
}

/**
 * The secret in a code as typed: any case, with or without dashes and spaces,
 * O read as 0 and I or L as 1. Null when it isn't a whole, valid code.
 */
export function parseChainCode(input: string): Uint8Array | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== CODE_LENGTH) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (value !== 0) return null;
  const secret = new Uint8Array(bytes.slice(0, SECRET_BYTES));
  return bytes.length === SECRET_BYTES + 1 && crc8(secret) === bytes[SECRET_BYTES] ? secret : null;
}

/** Normalises a typed code to its printed form, or null. */
export function normalizeChainCode(input: string): string | null {
  const secret = parseChainCode(input);
  return secret ? formatChainCode(secret) : null;
}

// ---------------------------------------------------------------------------
// Joining by link (what the QR holds)
// ---------------------------------------------------------------------------

/** perch://chain?server=…&code=… — the iPhone camera opens it in the app. */
export function chainLink(server: string, code: string): string {
  return `perch://chain?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}

export function parseChainLink(link: string): { server: string; code: string } | null {
  const m = /^perch:\/\/chain\?(.*)$/i.exec(link.trim());
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const code = normalizeChainCode(params.get('code') ?? '');
  const server = params.get('server') || DEFAULT_CHAIN_SERVER;
  return code && /^https?:\/\//i.test(server) ? { server, code } : null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface ChainKeys {
  /** Bearer token for the relay (base64url, 32 bytes). */
  token: string;
  enc: CryptoKey;
  mac: CryptoKey;
}

const buf = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;

async function hkdf(secret: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveChainKeys(secret: Uint8Array): Promise<ChainKeys> {
  const [token, enc, mac] = await Promise.all([
    hkdf(secret, 'perch/chain/token/v1'),
    hkdf(secret, 'perch/chain/enc/v1'),
    hkdf(secret, 'perch/chain/mac/v1'),
  ]);
  return {
    token: toBase64Url(token),
    enc: await crypto.subtle.importKey('raw', buf(enc), 'AES-GCM', false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.importKey('raw', buf(mac), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]),
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A record as the relay stores it. */
export interface ChainRecord {
  /** Opaque slot: base64url of the first 16 bytes of HMAC(mac, "type:id"). */
  key: string;
  hlc: string;
  deleted?: boolean;
  /** Read, unstarred state: the relay may forget it after 60 days. */
  ephemeral?: boolean;
  /** base64url(iv ‖ AES-GCM ciphertext) of {"type","id","data"}. */
  blob: string;
}

export interface ChainStoredRecord extends ChainRecord {
  version: number;
}

/** GET /chain/changes?since=&limit= */
export interface ChainChangesResponse {
  records: ChainStoredRecord[];
  cursor: number;
  more: boolean;
}

/** POST /chain/push */
export interface ChainPushRequest {
  records: ChainRecord[];
}

/** Results in request order; `key` is the slot. */
export interface ChainPushResponse {
  results: { key: string; status: PushStatus; version?: number }[];
  cursor: number;
}

/** POST /chain — create the chain for this token, or confirm it exists. */
export interface ChainCreateResponse {
  created: boolean;
  cursor: number;
}

/** Blobs above this are refused (a setting is at most 8 KiB as JSON). */
export const CHAIN_BLOB_MAX = 16 * 1024;

export async function chainSlot(keys: ChainKeys, type: RecordType, id: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    keys.mac,
    new TextEncoder().encode(recordKey(type, id)),
  );
  return toBase64Url(new Uint8Array(mac).slice(0, 16));
}

/** Binds a blob to its slot, clock and deleted flag, so the relay can't swap them. */
const additionalData = (key: string, hlc: string, deleted: boolean) =>
  new TextEncoder().encode(`${key}\n${hlc}\n${deleted ? 1 : 0}`);

export async function sealRecord(
  keys: ChainKeys,
  record: SyncRecord,
  /** Tests only: a fixed IV. */
  iv: Uint8Array = crypto.getRandomValues(new Uint8Array(12)),
): Promise<ChainRecord> {
  const key = await chainSlot(keys, record.type, record.id);
  const deleted = Boolean(record.deleted);
  const plain = JSON.stringify({
    type: record.type,
    id: record.id,
    ...(!deleted && { data: record.data }),
  });
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: additionalData(key, record.hlc, deleted) },
    keys.enc,
    new TextEncoder().encode(plain),
  );
  const state =
    record.type === 'state' && !deleted ? (record.data as RecordDataMap['state']) : null;
  return {
    key,
    hlc: record.hlc,
    ...(deleted && { deleted: true }),
    ...(state?.read && !state.starred && { ephemeral: true }),
    blob: toBase64Url(new Uint8Array([...iv, ...new Uint8Array(sealed)])),
  };
}

const RECORD_TYPES: readonly string[] = ['feed', 'category', 'setting', 'state'];

/**
 * The record inside a blob, or null when it doesn't decrypt or doesn't belong
 * in its slot (another chain's key, or tampering).
 */
export async function openRecord(
  keys: ChainKeys,
  stored: ChainStoredRecord,
): Promise<StoredRecord | null> {
  try {
    const bytes = fromBase64Url(stored.blob);
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(bytes.slice(0, 12)),
        additionalData: additionalData(stored.key, stored.hlc, Boolean(stored.deleted)),
      },
      keys.enc,
      buf(bytes.slice(12)),
    );
    const body = JSON.parse(new TextDecoder().decode(plain)) as {
      type: RecordType;
      id: string;
      data?: RecordDataMap[RecordType];
    };
    if (!RECORD_TYPES.includes(body.type) || typeof body.id !== 'string') return null;
    if ((await chainSlot(keys, body.type, body.id)) !== stored.key) return null;
    if (!stored.deleted && (!body.data || typeof body.data !== 'object')) return null;
    return {
      type: body.type,
      id: body.id,
      hlc: stored.hlc,
      version: stored.version,
      ...(stored.deleted ? { deleted: true } : { data: body.data }),
    };
  } catch {
    return null;
  }
}
