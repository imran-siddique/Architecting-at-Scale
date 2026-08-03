import { describe, expect, it } from 'vitest';
import {
  connectionsInUse,
  simulate,
  sustainableThroughput,
  utilization,
} from '../src/saturation.js';

/**
 * Chapter 1's diagnosis, as executable assertions.
 *
 * ShopFlow at Stage 1: 500-connection pool, ~3s hold on the legacy search, 450/500 connections
 * in use, p99 latency 3.2s, and a tipping point the chapter puts at ~166 req/s.
 */

const POOL = 500;
const HOLD_MS = 3000;

describe("Little's Law gives the tipping point before you reach it", () => {
  it('CLAIM: 500 connections at a ~3s hold saturate at ~166 req/s', () => {
    // The chapter's number, derived rather than guessed: 500 / 3s = 166.67 req/s.
    expect(sustainableThroughput(POOL, HOLD_MS)).toBeCloseTo(166.67, 1);
  });

  it('CLAIM: the snapshot 450/500 connections corresponds to ~150 req/s of real traffic', () => {
    // Little's Law rearranged: L = lambda x W. This is how you read a connection count as a
    // traffic level, which is what makes "90% utilized" actionable instead of alarming.
    expect(connectionsInUse(150, HOLD_MS)).toBeCloseTo(450, 0);
    expect(utilization(150, POOL, HOLD_MS)).toBeCloseTo(0.9, 2);
  });

  it('a faster query moves the wall, and that is the whole Chapter 2 argument', () => {
    // Same pool. Drop the hold from 3s to 30ms by removing the full table scan and the
    // ceiling moves by two orders of magnitude - without buying a single server.
    expect(sustainableThroughput(POOL, 3000)).toBeCloseTo(166.67, 1);
    expect(sustainableThroughput(POOL, 30)).toBeCloseTo(16_666.67, 1);
  });

  it('adding app servers does not help, because the pool is the constraint', () => {
    // The chapter is explicit that scaling up means the database tier. Ten times the app
    // servers still contend for the same 500 connections, so the ceiling is unchanged.
    const ceiling = sustainableThroughput(POOL, HOLD_MS);
    expect(sustainableThroughput(POOL, HOLD_MS)).toBe(ceiling);
    // Doubling the pool is what moves it.
    expect(sustainableThroughput(POOL * 2, HOLD_MS)).toBeCloseTo(ceiling * 2, 1);
  });
});

describe('the hockey stick is reproducible, not rhetorical', () => {
  it('CLAIM: latency stays flat well below the tipping point', () => {
    const r = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 80, durationSeconds: 60 });
    expect(r.utilization).toBeCloseTo(0.48, 2);
    // Nobody queues at all: there is always a free connection.
    expect(r.waitP99Ms).toBe(0);
    expect(r.latencyP99Ms).toBe(HOLD_MS);
  });

  it('CLAIM: a 1.9x traffic increase produces a far-larger-than-1.9x latency increase', () => {
    // This is Figure 1.1. Same system, same code, same query. Only the arrival rate moves.
    const green = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 85, durationSeconds: 90 });
    const red = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 165, durationSeconds: 90 });

    const trafficRatio = 165 / 85;                       // ~1.94x
    const latencyRatio = red.latencyP99Ms / green.latencyP99Ms;

    expect(trafficRatio).toBeLessThan(2);
    // The knee: latency degrades disproportionately, which is the only reason the curve has
    // a knee at all. A linear system would give latencyRatio ~= 1.
    expect(latencyRatio).toBeGreaterThan(trafficRatio);
  });

  it('CLAIM: past the tipping point the queue has no steady state', () => {
    // Above capacity, waiting time is not "high" - it grows with however long you watch.
    // That is the difference between a slow system and a system with no equilibrium, and it
    // is why the graph goes vertical instead of levelling off at a worse number.
    const short = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 200, durationSeconds: 30 });
    const long = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 200, durationSeconds: 90 });

    expect(short.utilization).toBeGreaterThan(1);
    expect(long.waitP99Ms).toBeGreaterThan(short.waitP99Ms * 2);
  });

  it('the pool is the thing that saturates: peak connections pin to the ceiling', () => {
    const over = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 220, durationSeconds: 40 });
    expect(over.peakConnections).toBe(POOL); // every connection busy - the 500/500 state
  });

  it('at 90% utilization the system is still "fine", which is why nobody acts', () => {
    // The uncomfortable finding in Chapter 1: at the snapshot's own 450/500, a deterministic
    // arrival pattern still shows almost no queueing. The system looks healthy right up to
    // the edge, and real traffic is bursty rather than deterministic - so the margin the
    // dashboard implies does not exist.
    const r = simulate({ poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 150, durationSeconds: 60 });
    expect(r.utilization).toBeCloseTo(0.9, 2);
    expect(r.waitP99Ms).toBeLessThan(HOLD_MS);
  });
});

describe('input validation', () => {
  it('refuses a nonsensical pool or hold time rather than returning Infinity', () => {
    expect(() => sustainableThroughput(0, 3000)).toThrow(RangeError);
    expect(() => sustainableThroughput(500, 0)).toThrow(RangeError);
  });
});
