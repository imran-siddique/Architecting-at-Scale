import type { CacheStore } from './ports.js';

/**
 * The Redis adapter for `CacheStore`.
 *
 * Kept deliberately thin, and typed against the minimum surface it needs rather than against a
 * client library, so the cache layer never acquires a hard dependency on one Redis package.
 * `test/redis-store.integration.spec.ts` runs this against a real Redis in CI; everything
 * else in the suite runs against the in-memory double.
 */

/** The subset of a Redis client this adapter uses. `ioredis` and `node-redis` both satisfy it. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number, nx: 'NX'): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export class RedisStore implements CacheStore {
  constructor(private readonly redis: RedisLike) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // EX is not optional. An entry with no expiry is how a cache becomes a second source of
    // truth that nobody can reconcile - and it removes the backstop that bounds a lost
    // invalidation event.
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    // SET ... EX <n> NX is a single atomic round trip. Doing this as EXISTS-then-SET is the
    // classic race: two instances both see "absent" and both believe they hold the lock.
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result !== null;
  }
}
