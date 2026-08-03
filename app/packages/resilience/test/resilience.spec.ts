import { describe, expect, it } from 'vitest';
import {
  NAIVE,
  SOUND,
  RetryBudget,
  amplificationFactor,
  delayFor,
  isRetryable,
  policyDefects,
  retry,
} from '../src/retry.js';
import { CHAPTER7_THRESHOLDS, CircuitBreaker } from '../src/circuit-breaker.js';
import {
  BulkheadSet,
  SHED_THRESHOLDS,
  assertPriorityOrdering,
  shouldShed,
  validateTimeoutHierarchy,
} from '../src/budgets.js';

/**
 * ShopFlow at the Chapter 7 state: 97.8% availability, three retry storms in 14 days, a 4.2%
 * checkout error rate, two connection-pool exhaustion events, and $10,000/mo of spend inflated by
 * redundant retry traffic.
 *
 * The opening incident is the thing to keep in mind: Pricing was never DOWN. It was slow.
 */

describe('the Retry Configuration Rule: all three controls are required', () => {
  it('CLAIM: a policy missing any of the three is a load amplifier, not resilience', () => {
    expect(policyDefects(NAIVE).sort()).toEqual(['exponential backoff', 'jitter', 'retry budget']);
    expect(policyDefects(SOUND)).toEqual([]);

    // Each omission is individually disqualifying, which is what "all three are required" means.
    expect(policyDefects({ ...SOUND, jitter: false })).toEqual(['jitter']);
    expect(policyDefects({ ...SOUND, multiplier: 1 })).toEqual(['exponential backoff']);
    expect(policyDefects({ ...SOUND, budgetRatio: 1 })).toEqual(['retry budget']);
  });

  it('CLAIM: naive retries TRIPLE the load on a dependency that is merely slow', () => {
    // This is the opening incident as arithmetic. Pricing did not fail; it slowed down. Three
    // attempts per call meant it received 3x the traffic at the exact moment it could absorb
    // least, which exhausted the shared pool and produced the 4.2% checkout error rate.
    expect(amplificationFactor(NAIVE)).toBe(3);
  });

  it('CLAIM: the retry BUDGET is the control that actually caps amplification', () => {
    // Backoff and jitter only spread retries out in time. They do not reduce the total.
    const spreadOnly = { ...NAIVE, baseDelayMs: 50, multiplier: 2, jitter: true };
    expect(amplificationFactor(spreadOnly)).toBe(3);

    // A 10% budget caps it near 1.3x, which a struggling dependency can absorb.
    expect(amplificationFactor(SOUND)).toBeCloseTo(1.3, 5);
    expect(amplificationFactor(SOUND)).toBeLessThan(amplificationFactor(spreadOnly));
  });

  it('backoff grows exponentially and jitter breaks the synchronization', () => {
    const noJitter = { ...SOUND, jitter: false };
    expect(delayFor(noJitter, 2)).toBe(50);
    expect(delayFor(noJitter, 3)).toBe(100);
    expect(delayFor(noJitter, 4)).toBe(200);
    expect(delayFor(noJitter, 9)).toBe(2000); // capped by maxDelayMs

    // With full jitter, two callers retrying at the same moment do not land together, which is
    // the entire reason jitter is on the required list.
    const a = delayFor(SOUND, 3, () => 0.1);
    const b = delayFor(SOUND, 3, () => 0.9);
    expect(a).not.toBe(b);
    expect(a).toBeLessThan(b);
  });

  it('enforces the budget across calls, not merely within one', () => {
    const budget = new RetryBudget(0.1);
    for (let i = 0; i < 10; i++) budget.recordRequest();

    expect(budget.tryConsume()).toBe(true);   // 1 retry against 10 requests is within 10%
    expect(budget.tryConsume()).toBe(false);  // a second would be 20%
    expect(budget.spent).toMatchObject({ total: 10, retries: 1 });
  });

  it('stops retrying once the budget is exhausted, and says so', async () => {
    const budget = new RetryBudget(0);   // no retries permitted at all
    const outcome = await retry(
      { kind: 'read' },
      SOUND,
      async () => { throw new Error('slow dependency'); },
      { budget, sleep: async () => {} },
    );
    expect(outcome.refusedBy).toBe('budget');
    expect(outcome.attemptsMade).toBe(1);
  });
});

describe('the Idempotency Rule', () => {
  it('CLAIM: reads retry freely', () => {
    expect(isRetryable({ kind: 'read' })).toBe(true);
  });

  it('CLAIM: a non-idempotent write with no dedup key must NOT be retried', () => {
    // "A duplicate charge is a worse outcome than a failed one." The failure goes back to the
    // caller so a human or a saga decides.
    expect(isRetryable({ kind: 'write', name: 'capturePayment' })).toBe(false);
  });

  it('an idempotency key makes a non-idempotent write retryable', () => {
    expect(isRetryable({ kind: 'write', idempotencyKey: 'order-1_intent-9' })).toBe(true);
    expect(isRetryable({ kind: 'write', idempotent: true })).toBe(true);
  });

  it('refuses at the retry boundary, returning the failure rather than risking a duplicate', async () => {
    let calls = 0;
    const outcome = await retry(
      { kind: 'write', name: 'capturePayment' },
      SOUND,
      async () => { calls++; throw new Error('timeout'); },
      { sleep: async () => {} },
    );

    expect(calls).toBe(1);                       // attempted exactly once
    expect(outcome.refusedBy).toBe('idempotency');
    expect(outcome.error?.message).toBe('timeout');
  });

  it('retries the same write once it carries a key', async () => {
    let calls = 0;
    const outcome = await retry(
      { kind: 'write', idempotencyKey: 'order-1_intent-9' },
      SOUND,
      async () => { calls++; if (calls < 3) throw new Error('timeout'); return 'captured'; },
      { sleep: async () => {}, random: () => 0.5 },
    );
    expect(calls).toBe(3);
    expect(outcome.value).toBe('captured');
  });
});

describe('the Graduated Response Rule', () => {
  const breaker = () => new CircuitBreaker(CHAPTER7_THRESHOLDS, () => 1_700_000_000_000);
  const feed = (b: CircuitBreaker, failures: number, successes: number) => {
    for (let i = 0; i < failures; i++) b.record('failure');
    for (let i = 0; i < successes; i++) b.record('success');
  };

  it('CLAIM: at 10% errors it throttles 25%, not opens', () => {
    // "Before a circuit opens, it should slow down."
    const b = breaker();
    feed(b, 3, 27);   // 10%
    expect(b.snapshot().state).toBe('throttled-25');
    expect(b.snapshot().admitFraction).toBe(0.75);
  });

  it('CLAIM: at 25% errors it throttles 50%', () => {
    const b = breaker();
    feed(b, 10, 30);  // 25%
    expect(b.snapshot().state).toBe('throttled-50');
    expect(b.snapshot().admitFraction).toBe(0.5);
  });

  it('CLAIM: at 50% errors it opens', () => {
    const b = breaker();
    feed(b, 20, 20);  // 50%
    expect(b.snapshot().state).toBe('open');
    expect(b.snapshot().admitFraction).toBe(0);
    expect(b.shouldAttempt(0.001)).toBe(false);
  });

  it('the graduated states admit traffic proportionally', () => {
    const b = breaker();
    feed(b, 3, 27);
    expect(b.shouldAttempt(0.5)).toBe(true);    // inside the 75% admitted
    expect(b.shouldAttempt(0.9)).toBe(false);   // in the shed 25%
  });

  it('CLAIM: below the minimum sample count it does not react at all', () => {
    // The direct counter to the Trigger-Happy anti-pattern: a threshold evaluated on three
    // requests opens on a single connection blip.
    const b = breaker();
    feed(b, 3, 0);   // 100% errors, but only 3 samples
    expect(b.snapshot().state).toBe('closed');
  });

  it('CLAIM: one successful probe does not close the circuit', () => {
    // Step 3 of the anti-pattern: the removed traffic makes the service look healthier, so a
    // single probe against 10% of normal load proves nothing.
    let t = 1_700_000_000_000;
    const b = new CircuitBreaker(CHAPTER7_THRESHOLDS, () => t);
    for (let i = 0; i < 20; i++) b.record('failure');
    expect(b.snapshot().state).toBe('open');

    t += CHAPTER7_THRESHOLDS.openMs;
    b.shouldAttempt(0.01);
    expect(b.snapshot().state).toBe('half-open');

    b.record('success');
    expect(b.snapshot().state).toBe('half-open');   // still probing
    b.record('success');
    b.record('success');
    expect(b.snapshot().state).toBe('closed');      // three consecutive
  });

  it('a failed probe re-opens immediately rather than continuing to test', () => {
    let t = 1_700_000_000_000;
    const b = new CircuitBreaker(CHAPTER7_THRESHOLDS, () => t);
    for (let i = 0; i < 20; i++) b.record('failure');
    t += CHAPTER7_THRESHOLDS.openMs;
    b.shouldAttempt(0.01);
    b.record('failure');
    expect(b.snapshot().state).toBe('open');
  });

  it('CLAIM: detects flapping, which is the failure that LOOKS like the breaker working', () => {
    let t = 1_700_000_000_000;
    const b = new CircuitBreaker(CHAPTER7_THRESHOLDS, () => t);

    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 20; i++) b.record('failure');
      t += CHAPTER7_THRESHOLDS.openMs;
      b.shouldAttempt(0.01);
      for (let i = 0; i < CHAPTER7_THRESHOLDS.probesToClose; i++) b.record('success');
    }

    expect(b.snapshot().flapCount).toBe(3);
    expect(b.isFlapping()).toBe(true);
  });
});

describe('the Bulkhead Mandate', () => {
  const pools = () =>
    new BulkheadSet([
      { name: 'checkout-db', priority: 'P0', limit: 20 },
      { name: 'pricing', priority: 'P2', limit: 5 },
      { name: 'recommendations', priority: 'P2', limit: 5 },
    ]);

  it('CLAIM: a slow P2 dependency cannot consume the P0 pool', () => {
    // The opening incident, made structurally impossible. Pricing saturates its own five slots
    // and checkout still has all twenty.
    const b = pools();
    for (let i = 0; i < 5; i++) expect(b.acquire('pricing')).toBe(true);

    expect(b.acquire('pricing')).toBe(false);          // its own bulkhead is full
    expect(b.available('checkout-db')).toBe(20);       // P0 untouched
    expect(b.acquire('checkout-db')).toBe(true);
  });

  it('rejects immediately instead of queueing: fail fast, not slow', () => {
    // An unbounded queue converts a saturated pool into unbounded latency, which is how a slow
    // dependency becomes an outage rather than a degradation.
    const b = pools();
    for (let i = 0; i < 5; i++) b.acquire('pricing');
    expect(b.acquire('pricing')).toBe(false);
    expect(b.rejected.get('pricing')).toBe(1);
  });

  it('releases slots back', () => {
    const b = pools();
    b.acquire('pricing');
    expect(b.available('pricing')).toBe(4);
    b.release('pricing');
    expect(b.available('pricing')).toBe(5);
  });

  it('requires a P0 bulkhead to exist at all', () => {
    const noP0 = new BulkheadSet([{ name: 'pricing', priority: 'P2', limit: 5 }]);
    expect(() => noP0.assertP0Isolated()).toThrow(/no P0 bulkhead/);
    expect(() => pools().assertP0Isolated()).not.toThrow();
  });
});

describe('the Timeout Hierarchy Rule', () => {
  it('accepts a hierarchy that decreases from the outside in', () => {
    expect(validateTimeoutHierarchy([
      { name: 'browser', timeoutMs: 10_000 },
      { name: 'api-gateway', timeoutMs: 8_000 },
      { name: 'bff', timeoutMs: 5_000 },
      { name: 'orders', timeoutMs: 3_000 },
      { name: 'pricing', timeoutMs: 1_000 },
    ])).toEqual([]);
  });

  it('CLAIM: an inverted timeout is flagged, because it manufactures retry storms', () => {
    // The outer layer gives up and retries while the inner layer is still working, so the
    // original request keeps running and the retry piles on top. Nothing is cancelled and
    // everything is duplicated.
    const problems = validateTimeoutHierarchy([
      { name: 'api-gateway', timeoutMs: 2_000 },
      { name: 'orders', timeoutMs: 5_000 },
    ]);
    expect(problems[0]).toMatchObject({ outer: 'api-gateway', inner: 'orders', reason: 'inner-not-less' });
  });

  it('flags equal timeouts and insufficient margin, not just inversions', () => {
    expect(validateTimeoutHierarchy([{ name: 'a', timeoutMs: 1000 }, { name: 'b', timeoutMs: 1000 }])[0])
      .toMatchObject({ reason: 'inner-not-less' });
    expect(validateTimeoutHierarchy([{ name: 'a', timeoutMs: 1000 }, { name: 'b', timeoutMs: 950 }])[0])
      .toMatchObject({ reason: 'insufficient-margin', marginMs: 50 });
  });
});

describe('the Load Shedding Priority Rule', () => {
  it('CLAIM: sheds in reverse priority order at the chapter’s thresholds', () => {
    expect(shouldShed('P2', 0.79).admit).toBe(true);
    expect(shouldShed('P2', 0.80).admit).toBe(false);   // P2 first, at 80%

    expect(shouldShed('P1', 0.85).admit).toBe(true);    // P1 still served
    expect(shouldShed('P1', 0.90).admit).toBe(false);

    expect(shouldShed('P0', 0.99).admit).toBe(true);    // P0 served to the last
    expect(shouldShed('P0', 1.00).admit).toBe(false);
  });

  it('CLAIM: shedding P0 always alerts, because it means beyond provisioned capacity', () => {
    const p0 = shouldShed('P0', 1.0);
    expect(p0).toMatchObject({ admit: false, alert: true });
    expect(p0.reason).toMatch(/beyond the provisioned capacity envelope/);

    // Shedding P2 is routine and must not page anyone.
    expect(shouldShed('P2', 0.95).alert).toBe(false);
  });

  it('CLAIM: at 85% utilization, checkout is served and recommendations are not', () => {
    // "A system that sheds P0 checkout requests to serve P2 recommendations has inverted its
    // business priorities." At the same instant, under the same load:
    expect(shouldShed('P0', 0.85).admit).toBe(true);
    expect(shouldShed('P2', 0.85).admit).toBe(false);
  });

  it('refuses an inverted configuration', () => {
    expect(() => assertPriorityOrdering()).not.toThrow();
    expect(() => assertPriorityOrdering({ P0: 0.8, P1: 0.9, P2: 1.0 }))
      .toThrow(/priorities are inverted/);
  });

  it('sanity: the thresholds are the ones the chapter states', () => {
    expect(SHED_THRESHOLDS).toEqual({ P2: 0.80, P1: 0.90, P0: 1.00 });
  });
});
