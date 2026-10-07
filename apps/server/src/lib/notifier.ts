// In-process fan-out of "something changed for this account" to open
// Server-Sent Event streams. Single process only, like the rate limiter.

export type AccountEvent =
  /** Sync records changed; pull from this version on. */
  | { type: 'cursor'; cursor: number }
  /** New articles arrived in one of the account's feeds. */
  | { type: 'articles' };

export class Notifier {
  private readonly listeners = new Map<string, Set<(event: AccountEvent) => void>>();

  subscribe(userId: string, listener: (event: AccountEvent) => void): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  emit(userId: string, event: AccountEvent): void {
    for (const listener of this.listeners.get(userId) ?? []) listener(event);
  }

  /** Whether anyone is listening; lets callers skip work nobody will see. */
  get active(): boolean {
    return this.listeners.size > 0;
  }
}
