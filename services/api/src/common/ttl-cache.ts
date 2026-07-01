/** Hard cap on distinct keys — a safety net independent of the sweep below
 *  (see MAX_ENTRIES eviction in `set`). */
const MAX_ENTRIES = 10_000;

/**
 * Minimal in-memory TTL cache. Used to avoid re-querying Supabase (Singapore,
 * ~80-150ms RTT) for data that rarely changes (tenant lookups, resolved auth
 * users) on every single request. Entries are invalidated explicitly by the
 * write paths that change the underlying data, so the TTL is just a safety
 * net, not the primary correctness mechanism.
 *
 * A key looked up exactly once (a user who logs in and never returns, a stale
 * bookmark) would otherwise sit in the map at its expired value forever —
 * `get()` only sweeps on a re-read, and nothing else ever touches that key
 * again. A periodic sweep plus a hard size cap bound memory to the number of
 * DISTINCT keys seen recently, not the number ever seen.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(private readonly ttlMs: number) {
    // Reuse the TTL as the sweep cadence — expired entries live at most
    // ~2x their TTL before being reclaimed either way. `unref()` so this
    // timer never keeps the process alive on its own.
    this.sweepTimer = setInterval(() => this.sweep(), ttlMs).unref();
  }

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (!this.store.has(key) && this.store.size >= MAX_ENTRIES) {
      // Map preserves insertion order — the first key is the oldest entry.
      // Not always the "most expired" one, but bounding size beats an exact
      // LRU here given how rarely this path should ever trigger.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Delete every entry whose key starts with `prefix` (e.g. all cached auth
   *  users for a tenant, when a role's permissions change). */
  deletePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Drop every already-expired entry. Runs on a timer (see constructor); also
   *  callable directly (e.g. tests). */
  private sweep(): void {
    const now = Date.now();
    for (const [key, hit] of this.store) {
      if (hit.expiresAt < now) this.store.delete(key);
    }
  }

  /** Stop the sweep timer (tests / explicit teardown — not required for
   *  normal operation since the timer is unref'd). */
  destroy(): void {
    clearInterval(this.sweepTimer);
  }
}
