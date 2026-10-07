import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';

// Outbound HTTP for everything the server fetches on a user's behalf (feeds,
// discovery probes, later full text). A user-supplied URL must not reach the
// server's own network: loopback, LAN, link-local and cloud metadata addresses
// are refused unless the admin opts in. The check runs at connection time on the
// resolved address, so DNS rebinding and redirects to internal hosts are covered.

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`Refusing to fetch ${host}: it resolves to a private or reserved address`);
    this.name = 'BlockedAddressError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for addresses a public feed can never legitimately live on. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) and NAT64 (64:ff9b::10.0.0.1) carry a v4 address.
    const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (embedded) return blocked.check(embedded, 'ipv4');
    return blocked.check(lower, 'ipv6');
  }
  return true;
}

export interface SafeFetchOptions {
  allowPrivate: boolean;
  allowHosts: string[];
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export type SafeFetch = (url: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT = 'PerchServer/0.1 (+https://github.com/perch-reader/perch)';

export function createSafeFetch(options: SafeFetchOptions): SafeFetch {
  const allowHosts = new Set(options.allowHosts);
  const allowed = (host: string) => options.allowPrivate || allowHosts.has(host.toLowerCase());

  // Every connection the agent opens resolves through here.
  const lookup: typeof dnsLookup = ((
    hostname: string,
    opts: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err);
      const usable = allowed(hostname)
        ? addresses
        : addresses.filter((a) => !isPrivateAddress(a.address));
      if (usable.length === 0) return callback(new BlockedAddressError(hostname));
      if (opts.all) return callback(null, usable);
      callback(null, usable[0]!.address, usable[0]!.family);
    });
  }) as typeof dnsLookup;

  const dispatcher = new Agent({
    connect: { lookup, timeout: 10_000 },
    headersTimeout: 15_000,
    bodyTimeout: 30_000,
  });

  return async (url, init = {}) => {
    const maxRedirects = options.maxRedirects ?? 5;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const headers = new Headers(init.headers as Record<string, string> | undefined);
    if (!headers.has('user-agent')) headers.set('user-agent', options.userAgent ?? USER_AGENT);

    let current = url;
    for (let hop = 0; ; hop++) {
      const target = new URL(current);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error(`Unsupported protocol ${target.protocol}`);
      }
      if (target.username || target.password)
        throw new Error('URLs with credentials are not fetched');
      // Literal IPs never go through DNS, so check them here.
      const literal = target.hostname.replace(/^\[|\]$/g, '');
      if (isIP(literal) && isPrivateAddress(literal) && !allowed(literal)) {
        throw new BlockedAddressError(literal);
      }

      const res = await undiciFetch(target, {
        ...init,
        headers,
        signal,
        dispatcher,
        redirect: 'manual',
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= maxRedirects) throw new Error('Too many redirects');
        current = new URL(location, target).toString();
        continue;
      }
      // Expose the final URL like fetch with redirect: 'follow' would.
      if (hop > 0) Object.defineProperty(res, 'url', { value: current });
      return res;
    }
  };
}

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Response is larger than ${Math.round(limit / 1024 / 1024)} MB`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Read a response body as text, refusing to buffer more than `maxBytes`. */
export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!res.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    // Throwing out of for-await cancels the stream.
    if (size > maxBytes) throw new ResponseTooLargeError(maxBytes);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(detectCharset(res.headers.get('content-type'), bytes));
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}

/**
 * The header's charset wins; otherwise the XML declaration or an HTML meta tag.
 * Plenty of Turkish and older feeds are ISO-8859-9 / windows-1254 and only say
 * so in `<?xml encoding="…"?>`.
 */
export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader;
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return (
    /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1] ??
    /<meta[^>]*charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8'
  );
}
