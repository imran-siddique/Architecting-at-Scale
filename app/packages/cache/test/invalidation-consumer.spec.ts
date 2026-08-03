import { describe, expect, it } from 'vitest';
import { CacheAside } from '../src/cache-aside.js';
import { InvalidationConsumer, type InvalidationEvent } from '../src/invalidation-consumer.js';
import { entityKey, edgePathsForProduct } from '../src/keys.js';
import { MemoryStore, RecordingPurgeTarget, TestClock, countingMetrics } from './fakes.js';

/**
 * The three failure modes Chapter 9 says an event-driven purge pipeline inherits from an
 * at-least-once broker: duplicate delivery, reordering, and loss. Each is a test.
 */

interface Product { id: string; title: string }

function setup() {
  const clock = new TestClock();
  const store = new MemoryStore(clock);
  const { metrics, counts } = countingMetrics();
  const cache = new CacheAside<Product>({
    store, keyspace: 'product', ttlSeconds: 300, jitter: 0, metrics, clock,
  });
  const cdn = new RecordingPurgeTarget('cdn');
  const shield = new RecordingPurgeTarget('origin-shield');
  const deadLettered: Array<{ event: InvalidationEvent; error: Error }> = [];

  const consumer = new InvalidationConsumer({
    store,
    cache: cache as unknown as Pick<CacheAside<unknown>, 'invalidate'>,
    purgeTargets: [cdn, shield],
    edgePaths: (e) => edgePathsForProduct(e.entityId),
    deadLetter: async (event, error) => void deadLettered.push({ event, error }),
    metrics,
    clock,
  });

  return { clock, store, cache, cdn, shield, consumer, counts, deadLettered };
}

const event = (over: Partial<InvalidationEvent> = {}): InvalidationEvent => ({
  eventId: 'evt-1',
  keyspace: 'product',
  entityId: 'p1',
  version: 2,
  emittedAt: 1_700_000_000_000,
  ...over,
});

const warm = (cache: CacheAside<Product>, id: string, version: number) =>
  cache.get(id, async () => ({ value: { id, title: `v${version}` }, version }));

describe('at-least-once delivery', () => {
  it('CLAIM: duplicate delivery of the same event purges exactly once', async () => {
    const { cache, consumer, cdn, store } = setup();
    await warm(cache, 'p1', 1);

    expect(await consumer.handle(event())).toBe('purged');
    expect(await consumer.handle(event())).toBe('duplicate');
    expect(await consumer.handle(event())).toBe('duplicate');

    expect(cdn.purged).toHaveLength(1); // not three
    expect(await store.get(entityKey('product', 'p1'))).toBeNull();
  });

  it('two DIFFERENT events for the same entity are both processed', async () => {
    // The dedupe key is the event id, not the entity id. Keying it on the entity would
    // silently drop the second of two legitimate writes.
    const { cache, consumer, cdn } = setup();

    await warm(cache, 'p1', 1);
    expect(await consumer.handle(event({ eventId: 'evt-a', version: 2 }))).toBe('purged');

    await warm(cache, 'p1', 2);
    expect(await consumer.handle(event({ eventId: 'evt-b', version: 3 }))).toBe('purged');

    expect(cdn.purged).toHaveLength(2);
  });

  it('CLAIM: an out-of-order (stale) event does not evict a newer cached value', async () => {
    const { cache, consumer, store, cdn, counts } = setup();
    await warm(cache, 'p1', 7); // cache holds version 7

    const ack = await consumer.handle(event({ eventId: 'late', version: 3 }));

    expect(ack).toBe('stale');
    expect(await store.get(entityKey('product', 'p1'))).not.toBeNull();
    expect(cdn.purged).toHaveLength(0); // the edge is not purged either
    expect(counts.staleInvalidation).toBe(1);
  });

  it('purges Redis and every edge tier, in parallel', async () => {
    const { cache, consumer, cdn, shield } = setup();
    await warm(cache, 'p9', 1);

    await consumer.handle(event({ entityId: 'p9', version: 2 }));

    expect(cdn.purged[0]).toEqual(['/api/catalog/products/p9', '/p/p9']);
    expect(shield.purged[0]).toEqual(['/api/catalog/products/p9', '/p/p9']);
  });

  it('records invalidation lag, so "how stale can this be" has an answer', async () => {
    const { cache, consumer, clock, counts } = setup();
    await warm(cache, 'p1', 1);

    const emittedAt = clock.now();
    clock.advance(250); // broker + consumer latency
    await consumer.handle(event({ emittedAt }));

    expect(counts.lags).toEqual([250]);
  });
});

describe('permanent failure', () => {
  it('dead-letters a failing purge and releases the dedupe claim for retry', async () => {
    const clock = new TestClock();
    const store = new MemoryStore(clock);
    const { metrics } = countingMetrics();
    const cache = new CacheAside<Product>({ store, keyspace: 'product', ttlSeconds: 300, jitter: 0, metrics, clock });
    const broken = new RecordingPurgeTarget('cdn', new Error('CDN 503'));
    const deadLettered: Array<{ event: InvalidationEvent; error: Error }> = [];
    const consumer = new InvalidationConsumer({
      store,
      cache: cache as unknown as Pick<CacheAside<unknown>, 'invalidate'>,
      purgeTargets: [broken],
      edgePaths: (e) => edgePathsForProduct(e.entityId),
      deadLetter: async (e, err) => void deadLettered.push({ event: e, error: err }),
      metrics,
      clock,
    });

    await warm(cache, 'p1', 1);
    expect(await consumer.handle(event())).toBe('dead-lettered');
    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0].error.message).toBe('CDN 503');

    // The claim was released, so a redelivery is retried rather than swallowed as a duplicate.
    expect(await consumer.handle(event())).toBe('dead-lettered');
    expect(deadLettered).toHaveLength(2);
  });

  it('CLAIM: a lost event is bounded by the TTL, which is why the TTL is mandatory', async () => {
    // Nothing here handles the message at all - it simply never arrives. The entry has to
    // fall out on its own, and that is the whole reason Chapter 9 refuses to allow an
    // entry without an expiry.
    const { cache, store, clock } = setup();
    await warm(cache, 'orphan', 1);
    expect(await store.get(entityKey('product', 'orphan'))).not.toBeNull();

    clock.advance(301_000); // TTL is 300s

    expect(await store.get(entityKey('product', 'orphan'))).toBeNull();
  });
});
