import { dedupeKey } from './keys.js';
import type { CacheStore, Clock, Metrics, PurgeTarget } from './ports.js';
import { noopMetrics, systemClock } from './ports.js';
import type { CacheAside } from './cache-aside.js';

/**
 * The invalidation consumer.
 *
 * This is the listing from Chapter 9, built out. It exists because an event-driven purge
 * pipeline inherits every failure mode of the broker underneath it, and Chapter 8 established
 * that every mainstream broker is at-least-once. So this consumer assumes three things will
 * happen, not that they might:
 *
 *   1. Duplicate delivery      -> an NX dedupe marker makes the purge idempotent
 *   2. Out-of-order delivery   -> a version guard drops a purge older than the cached entry
 *   3. Loss                    -> the TTL on every entry is the backstop, which is why a
 *                                 cache with no TTL is not recoverable by this pipeline
 *
 * The fourth thing it does is emit invalidation lag as a metric. Chapter 9 argues that
 * "how stale can this be" is unanswerable without it, and an unanswerable staleness question
 * is how a cache becomes a correctness problem instead of a performance one.
 */

export interface InvalidationEvent {
  /** Unique per publish. Two deliveries of one event share it; two events never do. */
  eventId: string;
  keyspace: string;
  entityId: string;
  /** The entity's version *after* the write that triggered this event. */
  version: number;
  /** When the producer emitted it, for lag measurement. */
  emittedAt: number;
}

export type Ack = 'purged' | 'duplicate' | 'stale' | 'dead-lettered';

export interface InvalidationConsumerOptions {
  store: CacheStore;
  cache: Pick<CacheAside<unknown>, 'invalidate'>;
  /** Edge tiers to purge alongside Redis: the CDN, then the origin shield. */
  purgeTargets?: PurgeTarget[];
  /** Maps an event to the public paths its entity is cached under at the edge. */
  edgePaths?: (event: InvalidationEvent) => string[];
  /** Where a permanently failing message goes. */
  deadLetter?: (event: InvalidationEvent, error: Error) => Promise<void>;
  /** How long a dedupe marker lives. Must exceed the broker's redelivery window. */
  dedupeTtlSeconds?: number;
  metrics?: Metrics;
  clock?: Clock;
}

export class InvalidationConsumer {
  private readonly o: InvalidationConsumerOptions & {
    dedupeTtlSeconds: number;
    metrics: Metrics;
    clock: Clock;
    purgeTargets: PurgeTarget[];
  };

  constructor(opts: InvalidationConsumerOptions) {
    this.o = {
      ...opts,
      purgeTargets: opts.purgeTargets ?? [],
      dedupeTtlSeconds: opts.dedupeTtlSeconds ?? 3600,
      metrics: opts.metrics ?? noopMetrics,
      clock: opts.clock ?? systemClock,
    };
  }

  /**
   * Handle one delivery. Safe to call twice with the same event, that is the entire point.
   * Never throws: a permanent failure is dead-lettered and acknowledged, because a message
   * that fails forever must not block the queue behind it.
   */
  async handle(event: InvalidationEvent): Promise<Ack> {
    // (1) Duplicate delivery. Claim the event id; if we lose the race, someone already did it.
    const claimed = await this.o.store.setIfAbsent(
      dedupeKey(event.eventId),
      '1',
      this.o.dedupeTtlSeconds,
    );
    if (!claimed) return 'duplicate';

    try {
      // (2) Out-of-order delivery. The version guard lives in the cache because only it can
      // compare against what is currently stored.
      const applied = await this.o.cache.invalidate(event.entityId, event.version);
      if (!applied) return 'stale';

      // Purge the edge tiers in parallel; they are independent, and serialising them makes
      // invalidation lag the sum of three vendor latencies instead of the max.
      const paths = this.o.edgePaths?.(event) ?? [];
      if (paths.length > 0 && this.o.purgeTargets.length > 0) {
        await Promise.all(this.o.purgeTargets.map((t) => t.purge(paths)));
      }

      this.o.metrics.invalidationLag(event.keyspace, this.o.clock.now() - event.emittedAt);
      return 'purged';
    } catch (err) {
      // (3) Anything permanent goes to the dead-letter queue with the event intact, so the
      // entity can be reconciled later. The TTL is what keeps this from being a correctness
      // bug in the meantime.
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.o.deadLetter) await this.o.deadLetter(event, error);
      // Release the dedupe claim so a redelivery can retry rather than being swallowed.
      await this.o.store.del(dedupeKey(event.eventId));
      return 'dead-lettered';
    }
  }
}
