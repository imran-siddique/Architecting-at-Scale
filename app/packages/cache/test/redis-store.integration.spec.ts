import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RedisStore } from '../src/redis-store.js';
import { CacheAside } from '../src/cache-aside.js';
import { entityKey } from '../src/keys.js';

/**
 * Integration coverage for the Redis adapter.
 *
 * Skipped unless REDIS_URL is set, so `npm test` still passes on a laptop with nothing
 * installed. CI sets it against a Redis service container, see .github/workflows/app-ci.yml.
 *
 * The unit suite proves the *logic*; this proves the two things only a real server can:
 * that SET..EX..NX is genuinely atomic, and that TTLs actually expire.
 */
const REDIS_URL = process.env.REDIS_URL;
const suite = REDIS_URL ? describe : describe.skip;

suite('RedisStore against a real Redis', () => {
  let redis: Redis;
  let store: RedisStore;
  const prefix = `test-${Date.now()}`;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL as string, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await redis.connect();
    store = new RedisStore(redis);
  });

  afterAll(async () => {
    const keys = await redis.keys(`*${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('round-trips a value with a TTL', async () => {
    const k = `${prefix}:rt`;
    await store.set(k, 'hello', 60);
    expect(await store.get(k)).toBe('hello');
    expect(await redis.ttl(k)).toBeGreaterThan(0);
  });

  it('returns null for an absent key', async () => {
    expect(await store.get(`${prefix}:absent`)).toBeNull();
  });

  it('actually expires an entry, the backstop for a lost invalidation event', async () => {
    const k = `${prefix}:ttl`;
    await store.set(k, 'transient', 1);
    expect(await store.get(k)).toBe('transient');
    await new Promise((r) => setTimeout(r, 1300));
    expect(await store.get(k)).toBeNull();
  });

  it('CLAIM: setIfAbsent is atomic, exactly one of N concurrent callers wins the lock', async () => {
    // This is the property the distributed herd lock rests on. An EXISTS-then-SET
    // implementation passes a sequential test and fails this one.
    const k = `${prefix}:lock`;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => store.setIfAbsent(k, 'held', 30)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('drives a full cache-aside read path end to end', async () => {
    const store2 = new RedisStore(redis);
    const cache = new CacheAside<{ id: string; title: string }>({
      store: store2,
      keyspace: `${prefix}-product`,
      ttlSeconds: 60,
      jitter: 0,
    });

    let originReads = 0;
    const load = async () => {
      originReads++;
      await new Promise((r) => setTimeout(r, 20));
      return { value: { id: 'p1', title: 'Oak Side Table' }, version: 3 };
    };

    // Concurrent misses across one process: single-flight collapses them.
    const all = await Promise.all(Array.from({ length: 20 }, () => cache.get('p1', load)));
    expect(all.every((r) => r?.title === 'Oak Side Table')).toBe(true);
    expect(originReads).toBe(1);

    // The version guard holds against a real store, not just a Map.
    expect(await cache.invalidate('p1', 2)).toBe(false);
    expect(await redis.get(entityKey(`${prefix}-product`, 'p1'))).not.toBeNull();
    expect(await cache.invalidate('p1', 3)).toBe(true);
    expect(await redis.get(entityKey(`${prefix}-product`, 'p1'))).toBeNull();
  });
});
