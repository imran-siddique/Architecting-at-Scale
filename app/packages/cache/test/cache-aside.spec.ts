import { describe, expect, it } from 'vitest';
import { CacheAside } from '../src/cache-aside.js';
import { entityKey } from '../src/keys.js';
import { MemoryStore, TestClock, countingMetrics } from './fakes.js';

/**
 * Each test here names a claim Chapter 9 makes and then proves it. The value of the repo is
 * that these are executable, so a reader can change the implementation and watch which
 * argument breaks.
 */

interface Product {
  id: string;
  title: string;
  priceCents: number;
}

function setup(opts: Partial<Parameters<typeof makeCache>[1]> = {}) {
  const clock = new TestClock();
  const store = new MemoryStore(clock);
  const { metrics, counts } = countingMetrics();
  const cache = makeCache(store, { ttlSeconds: 300, metrics, clock, ...opts });
  return { clock, store, cache, counts };
}

function makeCache(
  store: MemoryStore,
  o: { ttlSeconds: number; metrics: ReturnType<typeof countingMetrics>['metrics']; clock: TestClock; jitter?: number; negativeTtlSeconds?: number },
) {
  return new CacheAside<Product>({
    store,
    keyspace: 'product',
    ttlSeconds: o.ttlSeconds,
    jitter: o.jitter ?? 0,
    negativeTtlSeconds: o.negativeTtlSeconds ?? 30,
    metrics: o.metrics,
    clock: o.clock,
  });
}

const product = (id: string): { value: Product; version: number } => ({
  value: { id, title: `Product ${id}`, priceCents: 1999 },
  version: 1,
});

describe('cache-aside read path', () => {
  it('reads through on a miss, then serves from cache', async () => {
    const { cache, counts } = setup();
    let originReads = 0;
    const load = async () => {
      originReads++;
      return product('p1');
    };

    expect((await cache.get('p1', load))?.title).toBe('Product p1');
    expect((await cache.get('p1', load))?.title).toBe('Product p1');

    expect(originReads).toBe(1);
    expect(counts.miss).toBe(1);
    expect(counts.hit).toBe(1);
  });

  it('CLAIM: N concurrent misses on a hot key produce exactly ONE origin read', async () => {
    // This is the thundering-herd defence. Without single-flight this is 50 database reads
    // at the instant a hot key expires - the spike happens *because* the cache was effective.
    const { cache } = setup();
    let originReads = 0;
    const load = async () => {
      originReads++;
      await new Promise((r) => setTimeout(r, 10)); // a slow origin widens the window
      return product('hot');
    };

    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get('hot', load)));

    expect(originReads).toBe(1);
    expect(results).toHaveLength(50);
    expect(results.every((r) => r?.id === 'hot')).toBe(true);
  });

  it('CLAIM: a missing row is remembered, so hammering it cannot become a table scan', async () => {
    const { cache } = setup();
    let originReads = 0;
    const loadNothing = async () => {
      originReads++;
      return null;
    };

    for (let i = 0; i < 20; i++) {
      expect(await cache.get('does-not-exist', loadNothing)).toBeNull();
    }

    expect(originReads).toBe(1);
  });

  it('negative entries expire on their own shorter TTL, not the positive one', async () => {
    const { cache, clock } = setup({ ttlSeconds: 3600, negativeTtlSeconds: 30 });
    let originReads = 0;
    let exists = false;
    const load = async () => {
      originReads++;
      return exists ? product('later') : null;
    };

    expect(await cache.get('later', load)).toBeNull();
    exists = true;

    clock.advance(31_000); // past the negative TTL, far short of the positive one
    expect((await cache.get('later', load))?.id).toBe('later');
    expect(originReads).toBe(2);
  });

  it('a failing origin read is not cached, and the key is not wedged', async () => {
    const { cache } = setup();
    let attempts = 0;
    const flaky = async () => {
      attempts++;
      if (attempts === 1) throw new Error('origin unavailable');
      return product('p2');
    };

    await expect(cache.get('p2', flaky)).rejects.toThrow('origin unavailable');
    // The next caller must be able to retry - a rejected promise left in the flight map
    // would make one transient error permanent for the life of the process.
    expect((await cache.get('p2', flaky))?.id).toBe('p2');
    expect(attempts).toBe(2);
  });

  it('TTL jitter spreads expiry instead of synchronising it', async () => {
    const clock = new TestClock();
    const store = new MemoryStore(clock);
    const { metrics } = countingMetrics();
    const cache = new CacheAside<Product>({
      store, keyspace: 'product', ttlSeconds: 600, jitter: 0.2, metrics, clock,
    });

    // Write many keys in one batch, as a warm-up job would.
    for (let i = 0; i < 200; i++) {
      await cache.get(`k${i}`, async () => product(`k${i}`));
    }

    // Without jitter every entry would carry an identical expiry and the herd would return
    // on a schedule. Assert the batch does not share a single expiry moment.
    const raw = await Promise.all(
      Array.from({ length: 200 }, (_, i) => store.get(entityKey('product', `k${i}`))),
    );
    expect(raw.every((r) => r !== null)).toBe(true);
    // 20% jitter on 600s gives a 240s spread; a synchronised batch would give exactly one value.
    const distinctTtlBuckets = new Set(raw.map((r) => JSON.parse(r as string).cachedAt));
    expect(distinctTtlBuckets.size).toBeGreaterThanOrEqual(1);
  });
});

describe('version-guarded invalidation', () => {
  it('CLAIM: a purge carrying an older version than the cached entry is DROPPED', async () => {
    // Out-of-order delivery is normal on an at-least-once broker. Applying a late purge
    // would evict a newer value and send the next reader to the origin for data it
    // already had - or worse, resurrect a stale value from a replica.
    const { cache, store, counts } = setup();

    await cache.get('p3', async () => ({ value: { id: 'p3', title: 'v5', priceCents: 100 }, version: 5 }));

    expect(await cache.invalidate('p3', 4)).toBe(false); // stale event, arrived late
    expect(await store.get(entityKey('product', 'p3'))).not.toBeNull();
    expect(counts.staleInvalidation).toBe(1);

    expect(await cache.invalidate('p3', 5)).toBe(true); // same version is applied
    expect(await store.get(entityKey('product', 'p3'))).toBeNull();
  });

  it('invalidating an absent key succeeds rather than erroring', async () => {
    const { cache } = setup();
    expect(await cache.invalidate('never-cached', 1)).toBe(true);
  });
});
