import { describe, expect, it } from 'vitest';
import { OriginShield } from '../src/edge/origin-shield.js';
import { BABY_STEPS, bigBangShift, shiftTraffic } from '../src/edge/traffic-steering.js';
import { TestClock } from './fakes.js';

/**
 * Chapter 4's two origin-protection claims, and the steering rule.
 */

describe('the Origin Shield (Figure 4.1)', () => {
  it('CLAIM: 50 PoPs missing simultaneously produce exactly ONE origin fetch', () => {
    // The chapter's product-drop scenario, scaled down but structurally identical: the entry
    // expires, every PoP misses at the same instant, and the "Single Straw" origin sees one read.
    const clock = new TestClock();
    const shield = new OriginShield({
      popCount: 50, ttlMs: 60_000, staleWhileRevalidateMs: 60_000, now: () => clock.now(),
    });

    let originFetches = 0;
    const origin = async () => {
      originFetches++;
      await new Promise((r) => setTimeout(r, 5));
      return 'product-drop-payload';
    };

    return Promise.all(
      Array.from({ length: 50 }, (_, pop) => shield.get(pop, 'hot-product', origin)),
    ).then((bodies) => {
      expect(bodies.every((b) => b === 'product-drop-payload')).toBe(true);
      expect(originFetches).toBe(1);
      expect(shield.metrics.originFetches).toBe(1);
    });
  });

  it('CLAIM: many users of ONE PoP collapse into one upstream call', async () => {
    const clock = new TestClock();
    const shield = new OriginShield({
      popCount: 4, ttlMs: 60_000, staleWhileRevalidateMs: 60_000, now: () => clock.now(),
    });

    let originFetches = 0;
    const origin = async () => {
      originFetches++;
      await new Promise((r) => setTimeout(r, 5));
      return 'payload';
    };

    // 200 concurrent users, all on PoP 2.
    await Promise.all(Array.from({ length: 200 }, () => shield.get(2, 'k', origin)));
    expect(originFetches).toBe(1);
  });

  it('a warm PoP serves without touching the shield at all', async () => {
    const clock = new TestClock();
    const shield = new OriginShield({
      popCount: 2, ttlMs: 60_000, staleWhileRevalidateMs: 60_000, now: () => clock.now(),
    });
    const origin = async () => 'v1';

    await shield.get(0, 'k', origin);
    const before = shield.metrics.originFetches;
    for (let i = 0; i < 20; i++) await shield.get(0, 'k', origin);

    expect(shield.metrics.originFetches).toBe(before);
    expect(shield.metrics.popHits).toBe(20);
  });

  it('CLAIM: when the origin is DOWN, a stale entry is served — not a 404', async () => {
    // Chapter 4's Golden Rule: availability beats freshness. A 60-second-old price beats an
    // error page, and this is that rule as mechanism rather than sentiment.
    const clock = new TestClock();
    const shield = new OriginShield({
      popCount: 3, ttlMs: 30_000, staleWhileRevalidateMs: 120_000, now: () => clock.now(),
    });

    let originUp = true;
    const origin = async () => {
      if (!originUp) throw new Error('origin timeout');
      return 'price-1999';
    };

    expect(await shield.get(0, 'p1', origin)).toBe('price-1999');

    originUp = false;
    clock.advance(45_000); // past fresh, inside the stale-while-revalidate window

    // A different PoP, which never had a local copy, still serves from the shield's stale entry.
    expect(await shield.get(1, 'p1', origin)).toBe('price-1999');
    expect(shield.metrics.staleServed).toBeGreaterThan(0);
    expect(shield.metrics.hardFailures).toBe(0);
  });

  it('past the stale window with the origin still down, it fails rather than lying forever', async () => {
    // Stale-while-revalidate is a bounded promise. Serving a price indefinitely is a different
    // and worse failure than serving an error.
    const clock = new TestClock();
    const shield = new OriginShield({
      popCount: 2, ttlMs: 10_000, staleWhileRevalidateMs: 20_000, now: () => clock.now(),
    });

    let originUp = true;
    const origin = async () => {
      if (!originUp) throw new Error('origin down');
      return 'v1';
    };
    await shield.get(0, 'k', origin);

    originUp = false;
    clock.advance(40_000); // beyond ttl + swr

    expect(await shield.get(0, 'k', origin)).toBeNull();
    expect(shield.metrics.hardFailures).toBe(1);
  });

  it('a cold miss with a dead origin fails cleanly instead of hanging', async () => {
    const shield = new OriginShield({ popCount: 2, ttlMs: 1000, staleWhileRevalidateMs: 1000 });
    const origin = async () => {
      throw new Error('origin down');
    };
    expect(await shield.get(0, 'never-seen', origin)).toBeNull();
  });
});

describe('Baby-Step Traffic Steering (Figure 4.3)', () => {
  const budget = { maxP99Ms: 500, maxErrorRate: 0.01 };
  const healthy = () => ({ p99Ms: 200, errorRate: 0.001 });

  it('walks the ladder 1 -> 3 -> 10 -> 30 -> 100 when the region holds', () => {
    const r = shiftTraffic({ budget, observe: healthy });
    expect(r.completed).toBe(true);
    expect(r.finalWeight).toBe(100);
    expect(r.steps.map((s) => ('to' in s ? s.to : s.at))).toEqual([...BABY_STEPS]);
  });

  it('CLAIM: a region that buckles is caught at 1%, exposing 1% of requests', () => {
    // The secondary region cannot take the load. The rule exists so you learn that from 1% of
    // customers rather than from all of them.
    const r = shiftTraffic({
      budget,
      observe: (w) => (w >= 1 ? { p99Ms: 3000, errorRate: 0.4 } : healthy()),
    });

    expect(r.completed).toBe(false);
    expect(r.finalWeight).toBe(0);
    expect(r.requestsExposed).toBeCloseTo(0.01, 5);
    expect(r.steps.at(-1)).toMatchObject({ action: 'rollback', from: 1, to: 0 });
  });

  it('CLAIM: the same failure under a 100% flip exposes EVERY request', () => {
    const observe = (w: number) => (w >= 1 ? { p99Ms: 3000, errorRate: 0.4 } : healthy());
    const baby = shiftTraffic({ budget, observe });
    const bang = bigBangShift({ budget, observe });

    expect(bang.requestsExposed).toBe(1);
    // Two orders of magnitude, from the same failure in the same region.
    expect(bang.requestsExposed / baby.requestsExposed).toBeCloseTo(100, 0);
  });

  it('rolls back to the last healthy rung, not to zero', () => {
    // Rolling all the way back discards the knowledge that 10% was fine - and on a real
    // failover you usually still need somewhere to send traffic.
    const r = shiftTraffic({
      budget,
      observe: (w) => (w >= 30 ? { p99Ms: 900, errorRate: 0.02 } : healthy()),
    });
    expect(r.finalWeight).toBe(10);
    expect(r.steps.at(-1)).toMatchObject({ action: 'rollback', from: 30, to: 10 });
  });

  it('breaches either budget independently, and reports which', () => {
    const slow = shiftTraffic({ budget, observe: () => ({ p99Ms: 5000, errorRate: 0 }) });
    expect(slow.steps.at(-1)).toMatchObject({ breached: ['p99Ms'] });

    const errors = shiftTraffic({ budget, observe: () => ({ p99Ms: 100, errorRate: 0.5 }) });
    expect(errors.steps.at(-1)).toMatchObject({ breached: ['errorRate'] });

    const both = shiftTraffic({ budget, observe: () => ({ p99Ms: 5000, errorRate: 0.5 }) });
    expect(both.steps.at(-1)).toMatchObject({ breached: ['p99Ms', 'errorRate'] });
  });

  it('the first rung is small on purpose — never start above it', () => {
    expect(BABY_STEPS[0]).toBe(1);
    expect(Math.max(...BABY_STEPS)).toBe(100);
    // Monotonic, so no step ever reduces exposure by accident.
    expect([...BABY_STEPS]).toEqual([...BABY_STEPS].sort((a, b) => a - b));
  });
});
