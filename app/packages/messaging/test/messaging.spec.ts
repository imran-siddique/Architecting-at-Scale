import { describe, expect, it } from 'vitest';
import {
  DuplicateOperationError,
  SHOPFLOW_DUPLICATE_BUDGETS,
  brokenAttemptBasedKey,
  capturePaymentOnce,
  paymentIdempotencyKey,
  requiresExactlyOnceMachinery,
  type AuthoritativeLedger,
  type DedupStore,
  type PaymentOperation,
} from '../src/idempotency.js';
import {
  TransactionalStore,
  relayOnce,
  validatePollInterval,
  type Broker,
} from '../src/outbox.js';
import {
  CHECKOUT_STEPS,
  KAFKA_THROUGHPUT_THRESHOLD,
  analyzePath,
  classify,
  findBrokerCoupling,
  recommendBroker,
} from '../src/critical-path.js';

/**
 * ShopFlow at Chapter 8: a 2.1s synchronous checkout path, a 3.2% payment timeout rate each
 * holding a checkout thread for 3s, confirmation emails 8 to 12 seconds late, and three
 * double-charge incidents this month from retrying without an idempotency key.
 */

const OP: PaymentOperation = { orderId: 'o-1001', paymentIntentId: 'pi_77', amountCents: 18999 };

/** An atomic dedup store, as Redis SET NX provides. */
class AtomicDedup implements DedupStore {
  readonly keys = new Set<string>();
  async claim(key: string) {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
  async release(key: string) {
    this.keys.delete(key);
  }
  /** Simulate eviction, failover, or a flush. All ordinary operational events. */
  evictAll() {
    this.keys.clear();
  }
}

/**
 * The Optimistic Idempotency Key anti-pattern: check and set are separate awaits, so two
 * concurrent deliveries can both pass the check before either records anything.
 */
class NonAtomicDedup implements DedupStore {
  private readonly keys = new Set<string>();
  async claim(key: string) {
    const seen = this.keys.has(key);
    await new Promise((r) => setTimeout(r, 0)); // the window
    if (seen) return false;
    this.keys.add(key);
    return true;
  }
  async release(key: string) {
    this.keys.delete(key);
  }
}

class Ledger implements AuthoritativeLedger {
  readonly committed = new Map<string, PaymentOperation>();
  readonly charges: PaymentOperation[] = [];
  async commit(key: string, op: PaymentOperation) {
    if (this.committed.has(key)) throw new DuplicateOperationError(key);
    this.committed.set(key, op);
    this.charges.push(op);
  }
}

describe('the double-charge bug: the key was wrong', () => {
  it('CLAIM: an attempt-number key produces a DIFFERENT value per retry, so dedup cannot work', () => {
    // This is the mechanism behind three double charges a month. To the dedup store, retry 1 and
    // retry 2 are different operations, because as far as the key is concerned they are.
    expect(brokenAttemptBasedKey(OP, 1)).not.toBe(brokenAttemptBasedKey(OP, 2));
  });

  it('CLAIM: the stable key is identical across every retry of the same operation', () => {
    expect(paymentIdempotencyKey(OP)).toBe('o-1001_pi_77');
    expect(paymentIdempotencyKey({ ...OP })).toBe(paymentIdempotencyKey(OP));
  });

  it('CLAIM: retrying with an attempt-based key charges the customer twice', async () => {
    const ledger = new Ledger();
    const dedup = new AtomicDedup();

    // Two deliveries of the same logical payment, keyed by attempt number.
    for (const attempt of [1, 2]) {
      const key = brokenAttemptBasedKey(OP, attempt);
      if (await dedup.claim(key, 3600)) await ledger.commit(key, OP);
    }

    expect(ledger.charges).toHaveLength(2); // the incident
  });

  it('CLAIM: the same two deliveries with a stable key charge once', async () => {
    const deps = { dedup: new AtomicDedup(), ledger: new Ledger(), ttlSeconds: 3600 };

    const first = await capturePaymentOnce(OP, deps);
    const second = await capturePaymentOnce(OP, deps);

    expect(first.outcome).toBe('captured');
    expect(second.outcome).toBe('duplicate-suppressed');
    expect(deps.ledger.charges).toHaveLength(1);
  });

  it('refuses to build a key from incomplete operation identity', () => {
    expect(() => paymentIdempotencyKey({ ...OP, paymentIntentId: '' })).toThrow(/requires both/);
  });
});

describe('the double-charge bug: the check was not atomic', () => {
  it('CLAIM: a non-atomic check lets CONCURRENT duplicates both through', async () => {
    // The Optimistic Idempotency Key anti-pattern. Note the key here is correct and stable, so
    // fixing the key alone would not have prevented this.
    const dedup = new NonAtomicDedup();
    const ledger = new Ledger();
    const deps = { dedup, ledger, ttlSeconds: 3600 };

    const [a, b] = await Promise.all([
      capturePaymentOnce(OP, deps),
      capturePaymentOnce(OP, deps),
    ]);

    // Both passed the dedup check. Only the unique constraint stopped the second charge.
    expect([a.outcome, b.outcome].filter((o) => o === 'captured')).toHaveLength(1);
    expect([a, b].some((r) => r.suppressedBy === 'authoritative-ledger')).toBe(true);
    expect(ledger.charges).toHaveLength(1);
  });

  it('CLAIM: an atomic claim suppresses concurrent duplicates before the database', async () => {
    const deps = { dedup: new AtomicDedup(), ledger: new Ledger(), ttlSeconds: 3600 };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => capturePaymentOnce(OP, deps)),
    );

    expect(results.filter((r) => r.outcome === 'captured')).toHaveLength(1);
    expect(results.filter((r) => r.suppressedBy === 'dedup-store')).toHaveLength(19);
    expect(deps.ledger.charges).toHaveLength(1);
  });
});

describe('why Redis is a pre-check and the constraint is the guarantee', () => {
  it('CLAIM: when Redis loses the key, the unique constraint still prevents the charge', async () => {
    // Eviction under memory pressure, a failover with async replication, a flush during an
    // incident. All ordinary. A Redis-only design double charges on any of them.
    const dedup = new AtomicDedup();
    const ledger = new Ledger();
    const deps = { dedup, ledger, ttlSeconds: 3600 };

    expect((await capturePaymentOnce(OP, deps)).outcome).toBe('captured');

    dedup.evictAll();

    const afterEviction = await capturePaymentOnce(OP, deps);
    expect(afterEviction.outcome).toBe('duplicate-suppressed');
    expect(afterEviction.suppressedBy).toBe('authoritative-ledger');
    expect(ledger.charges).toHaveLength(1);
  });

  it('releases the claim on a genuine failure, so the payment is not silently lost', async () => {
    // The opposite failure and the worse one. Holding the claim after a real error means the
    // redelivery is treated as a duplicate and the customer is never charged at all.
    const dedup = new AtomicDedup();
    const failing: AuthoritativeLedger = {
      async commit() { throw new Error('database unavailable'); },
    };

    const result = await capturePaymentOnce(OP, { dedup, ledger: failing, ttlSeconds: 3600 });
    expect(result.outcome).toBe('failed');
    expect(dedup.keys.size).toBe(0); // claim released, retry possible
  });
});

describe('the Duplicate Budget Rule', () => {
  it('payment and inventory require exactly-once machinery; email and analytics do not', () => {
    const byName = new Map(SHOPFLOW_DUPLICATE_BUDGETS.map((b) => [b.consumer, b]));
    expect(requiresExactlyOnceMachinery(byName.get('payment-capture')!)).toBe(true);
    expect(requiresExactlyOnceMachinery(byName.get('inventory-reserve')!)).toBe(true);
    expect(requiresExactlyOnceMachinery(byName.get('analytics-ingest')!)).toBe(false);
  });

  it('every budget carries a rationale, because a tolerance without one gets copied', () => {
    for (const b of SHOPFLOW_DUPLICATE_BUDGETS) expect(b.rationale.length).toBeGreaterThan(20);
  });
});

describe('the Transactional Outbox', () => {
  const okBroker = (published: Array<{ topic: string; id: string }>): Broker => ({
    async publish(topic, _payload, eventId) { published.push({ topic, id: eventId }); },
  });

  it('CLAIM: without the outbox, a crash between write and publish loses the event FOREVER', async () => {
    // No consumer retry helps, because nothing was ever published. The order exists, inventory is
    // never reserved, and the only evidence is a customer complaint.
    const store = new TransactionalStore();
    let publishReached = false;

    await store.transaction((tx) => { tx.write('order:o-1', { id: 'o-1' }); });
    // ...process dies here, before the publish call.
    expect(publishReached).toBe(false);

    expect(store.get('order:o-1')).toBeTruthy();  // the write survived
    expect(store.pending()).toHaveLength(0);      // the event never existed
  });

  it('CLAIM: with the outbox, the event commits atomically with the domain write', async () => {
    const store = new TransactionalStore();
    await store.transaction((tx) => {
      tx.write('order:o-2', { id: 'o-2' });
      tx.enqueue({ eventId: 'e-1', topic: 'OrderPlaced', payload: { orderId: 'o-2' } });
    });

    expect(store.get('order:o-2')).toBeTruthy();
    expect(store.pending().map((e) => e.eventId)).toEqual(['e-1']);
  });

  it('CLAIM: a failed transaction discards the event too, so there is no orphan', async () => {
    const store = new TransactionalStore();
    await expect(
      store.transaction((tx) => {
        tx.write('order:o-3', { id: 'o-3' });
        tx.enqueue({ eventId: 'e-2', topic: 'OrderPlaced', payload: {} });
        throw new Error('payment declined');
      }),
    ).rejects.toThrow('payment declined');

    expect(store.get('order:o-3')).toBeUndefined();
    expect(store.pending()).toHaveLength(0);
  });

  it('the relay publishes pending events and marks them only after acknowledgement', async () => {
    const store = new TransactionalStore();
    const published: Array<{ topic: string; id: string }> = [];
    await store.transaction((tx) =>
      tx.enqueue({ eventId: 'e-3', topic: 'PaymentConfirmed', payload: { orderId: 'o-4' } }));

    const result = await relayOnce(store, okBroker(published), () => 1_700_000_000_000);

    expect(result.published).toEqual(['e-3']);
    expect(published).toEqual([{ topic: 'PaymentConfirmed', id: 'e-3' }]);
    expect(store.pending()).toHaveLength(0);
  });

  it('CLAIM: a broker failure leaves the event PENDING rather than marking it sent', async () => {
    // Marking before acknowledgement would turn at-least-once into at-most-once, and losing an
    // event is the exact failure the outbox exists to prevent.
    const store = new TransactionalStore();
    await store.transaction((tx) =>
      tx.enqueue({ eventId: 'e-4', topic: 'OrderPlaced', payload: {} }));

    const failing: Broker = { async publish() { throw new Error('broker unavailable'); } };
    const first = await relayOnce(store, failing);

    expect(first.failed).toEqual(['e-4']);
    expect(store.pending()).toHaveLength(1);

    // A later poll succeeds and the event is delivered late rather than lost.
    const published: Array<{ topic: string; id: string }> = [];
    const second = await relayOnce(store, okBroker(published), () => 1_700_000_000_000);
    expect(second.published).toEqual(['e-4']);
    expect(store.all()[0]!.attempts).toBe(2);
  });

  it('CLAIM: the relay can produce a DUPLICATE, which is why consumers need the key', async () => {
    // Publish succeeds, the relay dies before marking the row, the next poll publishes again.
    // This is not a flaw in the pattern; it is the source of at-least-once delivery and the
    // reason every consumer in this book deduplicates.
    const store = new TransactionalStore();
    await store.transaction((tx) =>
      tx.enqueue({ eventId: 'e-5', topic: 'OrderPlaced', payload: {} }));

    const published: Array<{ topic: string; id: string }> = [];
    const crashAfterPublish: Broker = {
      async publish(topic, _p, id) { published.push({ topic, id }); throw new Error('crashed after send'); },
    };

    await relayOnce(store, crashAfterPublish);
    await relayOnce(store, okBroker(published), () => 1_700_000_000_000);

    expect(published.filter((p) => p.id === 'e-5')).toHaveLength(2); // delivered twice
  });

  it('bounds table growth, because an unbounded outbox becomes the slowest table you own', async () => {
    const store = new TransactionalStore();
    for (let i = 0; i < 5; i++) {
      await store.transaction((tx) => tx.enqueue({ eventId: `p-${i}`, topic: 't', payload: {} }));
    }
    await relayOnce(store, { async publish() {} }, () => 1000);
    expect(store.prunePublished(2000)).toBe(5);
    expect(store.all()).toHaveLength(0);
  });

  it('the Polling Frequency Rule derives the interval from the delivery SLO', () => {
    // "If the consumer's maximum acceptable processing delay is 500ms, the polling interval must
    // be under 250ms." Half the SLO is the ceiling, not the target.
    expect(validatePollInterval(200, 500).ok).toBe(true);
    expect(validatePollInterval(250, 500).ok).toBe(true);
    const bad = validatePollInterval(400, 500);
    expect(bad.ok).toBe(false);
    expect(bad.ceiling).toBe(250);
    expect(bad.reason).toMatch(/consumes the budget/);
  });
});

describe('the Critical Path Separation Rule', () => {
  const analysis = analyzePath(CHECKOUT_STEPS);

  it('CLAIM: only three of seven checkout steps are user-blocking', () => {
    expect(analysis.blocking).toEqual(['validate-cart', 'reserve-inventory', 'authorize-payment']);
    expect(analysis.movable).toContain('notify-carrier');
    expect(analysis.movable).toContain('send-confirmation-email');
  });

  it('CLAIM: moving user-independent work off the path takes 2.1s to under 300ms', () => {
    // The Canon's Chapter 8 outcome, arrived at from the step latencies rather than asserted.
    expect(analysis.syncP99Ms).toBe(2100);
    expect(analysis.optimizedP99Ms).toBe(500);
    expect(analysis.optimizedP99Ms).toBeLessThan(analysis.syncP99Ms / 4);
  });

  it('CLAIM: a synchronous chain multiplies its dependencies availability', () => {
    // The reliability half, which gets less attention than the latency half. The chain needs
    // every dependency up at once, so removing steps improves reliability and not only speed.
    expect(analysis.chainAvailability).toBeLessThan(0.98);
    expect(analysis.optimizedAvailability).toBeGreaterThan(0.996);
  });

  it('the Synchronous-When-Blocking Rule keeps authorization synchronous', () => {
    // Making a blocking operation async does not remove its latency, it relocates it to where the
    // user cannot see it happening, and the failure surfaces after they have moved on.
    const auth = CHECKOUT_STEPS.find((s) => s.name === 'authorize-payment')!;
    expect(classify(auth)).toBe('user-blocking');
  });
});

describe('the Broker Fit Rule and the Kafka Default', () => {
  it("CLAIM: ShopFlow's workload does not justify Kafka", () => {
    const r = recommendBroker({
      sustainedMessagesPerSecond: 800,
      needsReplay: false,
      needsStrictPerPartitionOrdering: false,
      needsImmutableAuditLog: false,
    });
    expect(r.broker).toBe('managed-amqp');
    // The migration signal is named and measurable, so the decision is revisited on evidence
    // rather than on enthusiasm.
    expect(r.migrationTriggers.some((t) => t.includes(String(KAFKA_THROUGHPUT_THRESHOLD)))).toBe(true);
  });

  it('recommends Kafka when a real requirement appears, and says which one', () => {
    expect(recommendBroker({
      sustainedMessagesPerSecond: 25_000, needsReplay: false,
      needsStrictPerPartitionOrdering: false, needsImmutableAuditLog: false,
    })).toMatchObject({ broker: 'kafka' });

    const replay = recommendBroker({
      sustainedMessagesPerSecond: 100, needsReplay: true,
      needsStrictPerPartitionOrdering: false, needsImmutableAuditLog: false,
    });
    expect(replay.broker).toBe('kafka');
    expect(replay.reasons).toContain('message replay is a requirement');
  });

  it('CLAIM: detects Kafka primitives leaking into the consumer interface', () => {
    // The Broker Migration Rule. This is the difference between a config change and a rewrite.
    expect(findBrokerCoupling({ eventId: 1, partitionKey: 'x', consumerGroup: 'g' }).sort())
      .toEqual(['consumerGroup', 'partitionKey']);
    expect(findBrokerCoupling({ eventId: 1, topic: 't', payload: {} })).toEqual([]);
  });
});
