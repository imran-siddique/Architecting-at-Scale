import { SingleFlight } from './single-flight.js';
import { entityKey, herdLockKey } from './keys.js';
import type { CacheStore, Clock, Metrics } from './ports.js';
import { noopMetrics, systemClock } from './ports.js';

/**
 * A cached entry. The `version` is what makes invalidation safe under an at-least-once broker:
 * a purge carrying an older version than the entry is dropped rather than applied, because
 * events can arrive out of order and a late purge would otherwise evict a newer value.
 */
export interface Envelope<T> {
  value: T;
  version: number;
  cachedAt: number;
}

export interface CacheAsideOptions {
  store: CacheStore;
  keyspace: string;
  /** Base TTL. Real TTL is jittered to avoid a synchronised expiry wave. */
  ttlSeconds: number;
  /** Jitter fraction, 0..1. 0.1 spreads expiry over +/-10% of the TTL. */
  jitter?: number;
  /** How long a herd lock is held. Must exceed the p99 origin read. */
  lockTtlSeconds?: number;
  /** Cache a miss for this long to stop repeated lookups for a row that does not exist. */
  negativeTtlSeconds?: number;
  metrics?: Metrics;
  clock?: Clock;
}

/**
 * Sentinel for a negative cache entry. Deliberately not valid JSON, so it can never be
 * confused with a serialized Envelope, and deliberately not empty, so it is distinguishable
 * from a cache miss.
 */
const NEGATIVE = '__nil__';

/**
 * Cache-aside with the four defences Chapter 9 argues are mandatory rather than optional:
 * single-flight, a distributed herd lock, TTL jitter, and negative caching.
 *
 * The read path is: cache -> (in-process coalesce) -> (cross-process lock) -> origin.
 * Every layer exists to bound a different failure, and the chapter's point is that removing
 * any one of them reintroduces a specific outage you have already had.
 */
export class CacheAside<T> {
  private readonly flight = new SingleFlight<Envelope<T> | null>();
  private readonly o: Required<Omit<CacheAsideOptions, 'store' | 'keyspace' | 'metrics' | 'clock'>> &
    Pick<CacheAsideOptions, 'store' | 'keyspace'> & { metrics: Metrics; clock: Clock };

  constructor(opts: CacheAsideOptions) {
    this.o = {
      store: opts.store,
      keyspace: opts.keyspace,
      ttlSeconds: opts.ttlSeconds,
      jitter: opts.jitter ?? 0.1,
      lockTtlSeconds: opts.lockTtlSeconds ?? 5,
      negativeTtlSeconds: opts.negativeTtlSeconds ?? 30,
      metrics: opts.metrics ?? noopMetrics,
      clock: opts.clock ?? systemClock,
    };
  }

  /**
   * Read `id`, falling back to `load`. Returns null for a row that does not exist, and
   * remembers that fact for `negativeTtlSeconds` so a hammered missing key cannot become a
   * database scan. `load` must return the row's current version alongside its value.
   */
  async get(id: string, load: () => Promise<{ value: T; version: number } | null>): Promise<T | null> {
    const key = entityKey(this.o.keyspace, id);

    const cached = await this.o.store.get(key);
    if (cached !== null) {
      this.o.metrics.hit(this.o.keyspace);
      return cached === NEGATIVE ? null : (JSON.parse(cached) as Envelope<T>).value;
    }
    this.o.metrics.miss(this.o.keyspace);

    const before = this.flight.pending;
    const envelope = await this.flight.run(key, async () => {
      // Re-check inside the flight: a concurrent winner may have populated it already.
      const again = await this.o.store.get(key);
      if (again !== null) {
        return again === NEGATIVE ? null : (JSON.parse(again) as Envelope<T>);
      }
      return this.loadAndStore(key, load);
    });
    if (this.flight.pending > 0 && before > 0) this.o.metrics.coalesced(this.o.keyspace);

    return envelope ? envelope.value : null;
  }

  private async loadAndStore(
    key: string,
    load: () => Promise<{ value: T; version: number } | null>,
  ): Promise<Envelope<T> | null> {
    // Cross-process herd lock. One instance in the fleet reads the origin; the rest wait
    // briefly and then read the value the winner wrote. If we cannot get the lock and the
    // value still is not there, we fall through and read the origin rather than fail the
    // request, a slow read beats a 503, and the lock TTL bounds how long that can persist.
    const lockKey = herdLockKey(key);
    const won = await this.o.store.setIfAbsent(lockKey, '1', this.o.lockTtlSeconds);

    if (!won) {
      const waited = await this.awaitWinner(key);
      if (waited !== undefined) return waited;
    }

    try {
      const row = await load();
      if (row === null) {
        await this.o.store.set(key, NEGATIVE, this.o.negativeTtlSeconds);
        return null;
      }
      const envelope: Envelope<T> = {
        value: row.value,
        version: row.version,
        cachedAt: this.o.clock.now(),
      };
      await this.o.store.set(key, JSON.stringify(envelope), this.jitteredTtl());
      return envelope;
    } finally {
      if (won) await this.o.store.del(lockKey);
    }
  }

  /** Poll briefly for the lock winner's write. Returns undefined if it never lands. */
  private async awaitWinner(key: string, attempts = 5, delayMs = 20): Promise<Envelope<T> | null | undefined> {
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      const v = await this.o.store.get(key);
      if (v !== null) return v === NEGATIVE ? null : (JSON.parse(v) as Envelope<T>);
    }
    return undefined;
  }

  /**
   * TTL jitter. Without it, a batch of keys written together expires together, which
   * reproduces the herd on a schedule instead of at random.
   */
  private jitteredTtl(): number {
    const spread = this.o.ttlSeconds * this.o.jitter;
    const delta = (Math.random() * 2 - 1) * spread;
    return Math.max(1, Math.round(this.o.ttlSeconds + delta));
  }

  /**
   * Evict `id`, but only if `version` is at least as new as the cached entry.
   * Returns false when the purge was stale and therefore dropped.
   */
  async invalidate(id: string, version: number): Promise<boolean> {
    const key = entityKey(this.o.keyspace, id);
    const cached = await this.o.store.get(key);

    if (cached !== null && cached !== NEGATIVE) {
      const envelope = JSON.parse(cached) as Envelope<T>;
      if (envelope.version > version) {
        this.o.metrics.staleInvalidation(this.o.keyspace);
        return false;
      }
    }
    await this.o.store.del(key);
    return true;
  }
}
