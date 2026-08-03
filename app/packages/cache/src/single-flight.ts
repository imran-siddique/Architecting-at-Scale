/**
 * Single-flight: collapse concurrent identical misses into one origin call.
 *
 * This is the in-process half of the thundering-herd defence from Chapter 9. When a hot key
 * expires, every concurrent request for it misses at the same moment and they all go to the
 * database together — the origin sees a spike precisely because the cache was working well.
 *
 * Single-flight bounds that: the first caller does the work, everyone who arrives while it is
 * in progress waits on the same promise. N concurrent misses become 1 origin read.
 *
 * It is deliberately per-process. It does nothing about a herd spread across a fleet of
 * instances — that needs the distributed lock in `cache-aside.ts`. Both are required, and
 * neither is sufficient. See `test/single-flight.spec.ts` for the property this guarantees.
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  /**
   * Run `fn` for `key`, or join the call already running for it.
   * The entry is removed once settled, so a rejection is never cached.
   */
  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    // Start, register, and clean up in a finally so a throw does not wedge the key.
    const promise = (async () => fn())().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Number of distinct keys currently being fetched. Exposed for assertions and metrics. */
  get pending(): number {
    return this.inFlight.size;
  }
}
