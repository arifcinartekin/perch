import { sniffIsFeed } from '../parser';

// Fallback discovery: probe a bounded list of candidate URLs and keep the ones
// that actually return feed content. Deliberately conservative — short timeout,
// small read, hard cap on total requests, stop once we have enough.

export interface ProbeHit {
  url: string;
  contentType?: string;
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Stop after this many confirmed feeds. */
  maxHits?: number;
  /** Never make more than this many network requests. */
  maxRequests?: number;
  /** Run at most this many probes at once. */
  concurrency?: number;
  /** Fetch implementation; the server passes its SSRF-guarded fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULTS: Required<Omit<ProbeOptions, 'fetchImpl'>> = {
  timeoutMs: 3500,
  maxHits: 4,
  maxRequests: 20,
  concurrency: 4,
};

async function probeOne(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ProbeHit | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/json;q=0.9, */*;q=0.5',
      },
      credentials: 'omit',
      cache: 'no-cache',
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? undefined;

    // HTML is a strong negative signal (probably a 200 "not found" page).
    if (contentType && /text\/html/i.test(contentType)) {
      const peek = (await res.text()).slice(0, 500);
      return sniffIsFeed(peek, contentType) ? { url: res.url || url, contentType } : null;
    }

    const body = await res.text();
    return sniffIsFeed(body.slice(0, 2000), contentType)
      ? { url: res.url || url, contentType }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe candidates with bounded concurrency; resolve with confirmed feed URLs. */
export async function probeCandidates(
  candidates: string[],
  options: ProbeOptions = {},
): Promise<ProbeHit[]> {
  const opts = { ...DEFAULTS, ...options };
  const queue = candidates.slice(0, opts.maxRequests);
  const hits: ProbeHit[] = [];
  let index = 0;
  let requests = 0;

  async function worker() {
    while (index < queue.length && hits.length < opts.maxHits && requests < opts.maxRequests) {
      const url = queue[index++]!;
      requests++;
      const hit = await probeOne(url, opts.timeoutMs, opts.fetchImpl ?? fetch);
      if (hit && !hits.some((h) => h.url === hit.url)) hits.push(hit);
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, queue.length) }, worker));
  return hits.slice(0, opts.maxHits);
}
