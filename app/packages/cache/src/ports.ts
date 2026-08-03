/**
 * The ports the cache layer depends on.
 *
 * Chapter 9's cache is written against these interfaces rather than against a Redis client, for
 * one reason that matters more than testability: the invalidation pipeline has to purge Redis,
 * the CDN, and the origin shield, and those are three different products with three different
 * failure modes. Naming them as ports keeps the tiering explicit instead of scattering
 * vendor calls through the read path.
 *
 * The in-memory implementations in `test/fakes.ts` are what let the test suite prove the
 * chapter's claims without standing up infrastructure.
 */

/** A key/value tier with a TTL. Redis in production; a Map in the tests. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` is required — an entry with no expiry is a leak, not a cache. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<number>;
  /**
   * Set only if absent, with a TTL. Returns true if this caller won.
   * This is the primitive behind both the distributed herd lock and the
   * at-least-once delivery dedupe in the invalidation consumer.
   */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

/** An edge tier that can purge by path. A CDN, or the origin shield in front of it. */
export interface PurgeTarget {
  readonly name: string;
  purge(paths: string[]): Promise<void>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface Metrics {
  hit(keyspace: string): void;
  miss(keyspace: string): void;
  /** A miss that arrived while an identical fetch was already running. */
  coalesced(keyspace: string): void;
  /** A purge rejected because it carried an older version than the cached entry. */
  staleInvalidation(keyspace: string): void;
  /** Invalidation lag: event emitted -> caches purged. A first-class metric in Chapter 9. */
  invalidationLag(keyspace: string, ms: number): void;
}

export const noopMetrics: Metrics = {
  hit: () => {},
  miss: () => {},
  coalesced: () => {},
  staleInvalidation: () => {},
  invalidationLag: () => {},
};
