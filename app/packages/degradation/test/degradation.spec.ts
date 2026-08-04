import { describe, expect, it } from 'vitest';
import {
  CORRECTNESS_FLOOR,
  SHOPFLOW_CAPABILITIES,
  coverageReport,
  grade,
  isCorrectnessFloor,
} from '../src/classification.js';
import {
  applyFairShare,
  attemptCheckout,
  type Consumer,
  type DegradedContext,
} from '../src/degraded-checkout.js';
import {
  CHAOS_RUNGS,
  assessShedding,
  mayRunAt,
  validateExperiment,
  type RungHistory,
} from '../src/chaos.js';

/**
 * ShopFlow at Chapter 12: it can see its failures (Chapter 11) and has no defined behaviour for
 * them. Every service has a happy-path SLO and none has a documented degraded path.
 */

describe('P0/P1/P2 classification', () => {
  it('grades by hourly impact', () => {
    expect(grade(SHOPFLOW_CAPABILITIES[0]!)).toMatchObject({ priority: 'P0', capability: 'complete-checkout' });
    expect(grade(SHOPFLOW_CAPABILITIES[2]!)).toMatchObject({ priority: 'P1', capability: 'product-search' });
    expect(grade(SHOPFLOW_CAPABILITIES[3]!)).toMatchObject({ priority: 'P2', capability: 'recommendations' });
  });

  it('CLAIM: a P0 with no documented degraded path is refused, not graded', () => {
    // This is the gap ShopFlow enters the chapter with: a priority and no plan.
    expect(() =>
      grade({ name: 'inventory-lookup', hourlyImpactUsd: 20_000, hasMeaningfulDegradedMode: true }),
    ).toThrow(/no documented degraded behaviour/);
  });

  it('CLAIM: every P0 must name its P0P0', () => {
    expect(() =>
      grade({
        name: 'inventory-lookup',
        hourlyImpactUsd: 20_000,
        hasMeaningfulDegradedMode: true,
        degradedBehaviour: 'serve last-known stock counts',
      }),
    ).toThrow(/no P0P0 declared/);
  });

  it('a P1 does not need a P0P0, because there is no P0 to survive', () => {
    expect(
      grade({
        name: 'wishlist',
        hourlyImpactUsd: 2_000,
        hasMeaningfulDegradedMode: true,
        degradedBehaviour: 'read-only',
      }),
    ).toMatchObject({ priority: 'P1' });
  });
});

describe('the Correctness Floor', () => {
  it('CLAIM: five capabilities are never graded P0/P1/P2', () => {
    for (const c of ['authentication', 'authorization', 'payment-integrity', 'audit-logging', 'data-integrity-constraints']) {
      expect(isCorrectnessFloor(c)).toBe(true);
    }
    expect(CORRECTNESS_FLOOR).toContain('regulatory-and-privacy-controls');
  });

  it('CLAIM: a fast wrong answer is not a degraded mode, it is a defect with better latency', () => {
    // payment-integrity has the SAME hourly impact as checkout. Impact does not make it gradeable.
    const g = grade({ name: 'payment-integrity', hourlyImpactUsd: 42_000, hasMeaningfulDegradedMode: false });
    expect(g.priority).toBe('ungraded');
    expect(g).toMatchObject({ reason: expect.stringMatching(/defect with better latency/) });
  });

  it('the impact number does not promote a floor capability to P0', () => {
    const high = grade({ name: 'authorization', hourlyImpactUsd: 999_999, hasMeaningfulDegradedMode: false });
    const low = grade({ name: 'audit-logging', hourlyImpactUsd: 1, hasMeaningfulDegradedMode: false });
    expect(high.priority).toBe('ungraded');
    expect(low.priority).toBe('ungraded');
  });

  it('the ShopFlow inventory separates graded capabilities from the floor', () => {
    const r = coverageReport(SHOPFLOW_CAPABILITIES);
    expect(r.graded).toHaveLength(4);
    expect(r.ungraded.map((g) => g.capability)).toEqual(['payment-integrity', 'authorization', 'audit-logging']);
    expect(r.p0WithoutDegradedPath).toEqual([]);
    expect(r.p0WithoutP0p0).toEqual([]);
  });
});

describe('the degraded checkout, composed', () => {
  const healthy: DegradedContext = {
    pricingServiceHealthy: true,
    dynamicPricingFlagEnabled: true,
    cachedPriceAvailable: true,
    paymentGatewayHealthy: true,
    fulfilmentQueueAvailable: true,
  };

  it('CLAIM: the six mechanisms compose into a completed order under pricing failure', () => {
    const r = attemptCheckout({ ...healthy, pricingServiceHealthy: false });
    expect(r.accepted).toBe(true);
    expect(r.steps.map((s) => s.action)).toEqual([
      'pricing breaker opened',
      'dynamic-pricing flag disabled',
      'cached pricing served',
      'payment intent captured',
      'order queued for fulfilment',
      'customer acknowledged',
    ]);
  });

  it('CLAIM: what matters is what did NOT happen', () => {
    // Nobody charged without an order, no invented price, no skipped audit entry. The correctness
    // floor held while everything above it degraded.
    for (const ctx of [
      healthy,
      { ...healthy, pricingServiceHealthy: false },
      { ...healthy, pricingServiceHealthy: false, cachedPriceAvailable: false },
      { ...healthy, paymentGatewayHealthy: false },
      { ...healthy, fulfilmentQueueAvailable: false },
    ]) {
      const r = attemptCheckout(ctx);
      expect(r.chargedWithoutOrder).toBe(false);
      expect(r.inventedPrice).toBe(false);
      expect(r.auditWritten).toBe(true);
    }
  });

  it('CLAIM: with no cached price it REFUSES rather than inventing one', () => {
    const r = attemptCheckout({ ...healthy, pricingServiceHealthy: false, cachedPriceAvailable: false });
    expect(r.accepted).toBe(false);
    expect(r.inventedPrice).toBe(false);
    expect(r.customerMessage).toMatch(/Nothing has been charged/);
  });

  it('CLAIM: the P0P0 is the payment intent, and a lost queue releases it', () => {
    // A captured intent with no order is the outcome the P0P0 exists to prevent. If the order cannot
    // be recorded, the intent must not survive.
    const r = attemptCheckout({ ...healthy, fulfilmentQueueAvailable: false });
    expect(r.accepted).toBe(false);
    expect(r.paymentIntentCaptured).toBe(false);
    expect(r.chargedWithoutOrder).toBe(false);
    expect(r.steps.at(-1)!.action).toBe('queue unavailable, payment intent released');
  });

  it('the degraded path tells the customer the truth about pricing', () => {
    expect(attemptCheckout(healthy).customerMessage).toBe('Order confirmed.');
    expect(attemptCheckout({ ...healthy, pricingServiceHealthy: false }).customerMessage)
      .toMatch(/Final pricing will be confirmed/);
  });
});

describe('fairness within a traffic class', () => {
  const consumers: Consumer[] = [
    { id: 'partner-a', priority: 'P1', requestsInWindow: 100, costUnits: 900 },
    { id: 'partner-b', priority: 'P1', requestsInWindow: 100, costUnits: 40 },
    { id: 'partner-c', priority: 'P1', requestsInWindow: 100, costUnits: 30 },
    { id: 'partner-d', priority: 'P1', requestsInWindow: 100, costUnits: 30 },
  ];

  it('CLAIM: priority ordering alone lets one consumer take the whole class', () => {
    // Identical request counts, wildly different cost. Priority says nothing about this.
    const r = applyFairShare(consumers, 'P1', 1000);
    expect(r.largestShare).toBe(0.9); // one of four consumers, 90% of the class
    expect(r.largestShare).toBeGreaterThan(1 / consumers.length);
    expect(r.throttled).toEqual(['partner-a']);
    expect(r.admitted).toEqual(['partner-b', 'partner-c', 'partner-d']);
  });

  it('CLAIM: the Fair Share Rule weights by COST, not request count', () => {
    // partner-a is inside any count-based quota (100 requests, same as everyone) and still consumes
    // the class. A numeric request limit would have admitted it.
    const byCount = consumers.every((c) => c.requestsInWindow === 100);
    expect(byCount).toBe(true);
    expect(applyFairShare(consumers, 'P1', 1000).throttled).toContain('partner-a');
  });

  it('an evenly loaded class throttles nobody', () => {
    const even = consumers.map((c) => ({ ...c, costUnits: 200 }));
    const r = applyFairShare(even, 'P1', 1000);
    expect(r.throttled).toEqual([]);
    expect(r.largestShare).toBeCloseTo(0.25, 2);
  });

  it('fairness is computed per class, so P0 is unaffected by a greedy P1', () => {
    const mixed: Consumer[] = [
      ...consumers,
      { id: 'storefront', priority: 'P0', requestsInWindow: 5000, costUnits: 4000 },
    ];
    expect(applyFairShare(mixed, 'P0', 5000).admitted).toEqual(['storefront']);
  });
});

describe('the chaos progression', () => {
  const clean = (level: number, runs: number): RungHistory => ({
    level,
    productionRunsClean: runs,
    runsWithCustomerImpact: 0,
  });

  it('rung 1 is always available', () => {
    expect(mayRunAt(1, []).allow).toBe(true);
  });

  it('CLAIM: you may not run at N+1 until every rung up to N has a clean record', () => {
    expect(mayRunAt(3, [clean(1, 3)])).toMatchObject({ allow: false, reason: /rung 2 .* never been run/ });
    expect(mayRunAt(3, [clean(1, 3), clean(2, 1)])).toMatchObject({ allow: false, reason: /needs 3/ });
    expect(mayRunAt(3, [clean(1, 3), clean(2, 3)]).allow).toBe(true);
  });

  it('CLAIM: a run with customer impact resets the progression at that rung', () => {
    const history = [clean(1, 3), { level: 2, productionRunsClean: 9, runsWithCustomerImpact: 1 }];
    expect(mayRunAt(3, history)).toMatchObject({
      allow: false,
      reason: /teaches the organization that chaos engineering causes incidents/,
    });
  });

  it('you cannot skip a lower rung on the grounds that it is obvious', () => {
    // Every lower rung clean except rung 1, which was never bothered with.
    expect(mayRunAt(5, [clean(2, 3), clean(3, 5), clean(4, 5)]))
      .toMatchObject({ allow: false, reason: /rung 1 .* never been run/ });
  });

  it('CLAIM: every rung declares an abort condition and a hypothesis', () => {
    for (const rung of CHAOS_RUNGS) {
      expect(() => validateExperiment(rung)).not.toThrow();
      expect(rung.abortOn.length).toBeGreaterThan(0);
    }
    expect(() => validateExperiment({ hypothesis: 'the breaker opens' }))
      .toThrow(/it is an outage you scheduled/);
    expect(() => validateExperiment({ abortOn: 'error rate > 1%' })).toThrow(/no hypothesis/);
  });

  it('the staging rungs are the price of admission to production', () => {
    // Rungs 1 and 2 are staging, 3 through 5 are production. Reaching the FIRST production rung
    // costs six clean staging runs, which is the whole point of putting them first.
    const staging = CHAOS_RUNGS.filter((r) => r.name.includes('staging'));
    const production = CHAOS_RUNGS.filter((r) => r.name.includes('production'));
    expect(staging.map((r) => r.level)).toEqual([1, 2]);
    expect(production.map((r) => r.level)).toEqual([3, 4, 5]);
    expect(staging.reduce((a, r) => a + r.cleanRunsRequired, 0)).toBe(6);
  });
});

describe('load-shedding economics', () => {
  it('CLAIM: break-even is about a month, not "less than 2 days"', () => {
    // The manuscript claimed under 2 days against $2,400/month of savings and ~3 engineering days of
    // build. Three engineering days at a loaded rate does not repay from $2,400/month in two days.
    const v = assessShedding({ monthlySavingsUsd: 2400, engineeringDays: 3, loadedDailyRateUsd: 800 });
    expect(v.buildCostUsd).toBe(2400);
    expect(v.monthsToBreakEven).toBeCloseTo(1, 2);
    expect(v.daysToBreakEven).toBeCloseTo(30, 0);
    expect(v.daysToBreakEven).toBeGreaterThan(2);
  });

  it('the claim fails at every plausible loaded rate', () => {
    for (const rate of [400, 600, 800, 1200, 1600]) {
      const v = assessShedding({ monthlySavingsUsd: 2400, engineeringDays: 3, loadedDailyRateUsd: rate });
      expect(v.daysToBreakEven).toBeGreaterThan(2);
    }
  });

  it('names the two denominators that got confused', () => {
    const v = assessShedding({ monthlySavingsUsd: 2400, engineeringDays: 3, loadedDailyRateUsd: 800 });
    expect(v.note).toMatch(/BUILD COST/);
    expect(v.note).toMatch(/not interchangeable/);
  });

  it('the investment is still clearly worth making, which is the point', () => {
    // Correcting the figure does not weaken the case. An eleven-month payback inside one year is a
    // good return; the original number was just not true.
    const v = assessShedding({ monthlySavingsUsd: 2400, engineeringDays: 3, loadedDailyRateUsd: 800 });
    expect(v.firstYearNetUsd).toBe(26_400);
    expect(v.monthsToBreakEven).toBeLessThan(12);
  });
});
