// Fixed-window counters in memory. Enough for a single-process server; the
// official multi-instance deployment will need a shared store.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Seconds until the key may try again, or 0 when it is under the limit. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now || entry.count < this.limit) return 0;
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  hit(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
