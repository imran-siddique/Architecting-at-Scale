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
 * ShopFlow at Stage 1: a 500-connection pool, a ~3s hold on the legacy search, 450/500
 * connections in use, p99 latency 3.2s, and a tipping point the chapter puts at ~166 req/s.
 */

const POOL = 500;
const HOLD_MS = 3000;

describe("Little's Law gives the tipping point before you reach it", () => {
  it('CLAIM: 500 connections at a ~3s hold saturate at ~166 req/s', () => {
    // The chapter's number, derived rather than guessed: 500 / 3s = 166.67 req/s.
    expect(sustainableThroughput(POOL, HOLD_MS)).toBeCloseTo(166.67, 1);
  });

  it('CLAIM: the snapshot 450/500 connections corresponds to ~150 req/s of real traffic', () => {
    // Little's Law rearranged: L = lambda x W. This is how a connection count is read as a
    // traffic level, which makes "90% utilized" actionable rather than merely alarming.
    expect(connectionsInUse(150, HOLD_MS)).toBeCloseTo(450, 0);
    expect(utilization(150, POOL, HOLD_MS)).toBeCloseTo(0.9, 2);
  });

  it('a faster query moves the wall, and that is the whole Chapter 2 argument', () => {
    // Same pool. Drop the hold from 3s to 30ms by removing the full table scan and the
    // ceiling moves by two orders of magnitude, without buying a single server.
    expect(sustainableThroughput(POOL, 3000)).toBeCloseTo(166.67, 1);
    expect(sustainableThroughput(POOL, 30)).toBeCloseTo(16_666.67, 1);
  });

  it('adding app servers does not help, because the pool is the constraint', () => {
    // The chapter is explicit that "scale up" means the database tier. Ten times the app
    // servers still contend for the same 500 connections, so the ceiling does not move.
    const ceiling = sustainableThroughput(POOL, HOLD_MS);
    expect(sustainableThroughput(POOL * 2, HOLD_MS)).toBeCloseTo(ceiling * 2, 1);
  });

  it('refuses a nonsensical pool or hold time rather than returning Infinity', () => {
    expect(() => sustainableThroughput(0, 3000)).toThrow(RangeError);
    expect(() => sustainableThroughput(500, 0)).toThrow(RangeError);
  });
});

/**
 * The knee in Figure 1.1 is caused by VARIABILITY, not by utilization on its own.
 *
 * This is the most useful thing in the file, and it was learned the hard way: the first version
 * of this suite modelled arrivals as perfectly evenly spaced and then asserted a knee. CI
 * failed it, correctly. A D/D/c queue has exactly zero queueing below 100% utilization and
 * unbounded queueing above it — a step function with no curve anywhere.
 *
 * Real users do not arrive on a metronome. Once arrivals clump, a clump can exceed the pool
 * while the *average* still looks comfortable, and that is the entire reason 90% average
 * utilization is not 10% of headroom.
 */
describe('the knee comes from burstiness, not from utilization alone', () => {
  it('CLAIM: with perfectly smooth arrivals at 90% utilization, nobody queues at all', () => {
    const smooth = simulate({
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 150,
      durationSeconds: 90, arrivals: 'deterministic',
    });

    expect(smooth.utilization).toBeCloseTo(0.9, 2);
    expect(smooth.waitP99Ms).toBe(0);          // not "small" - zero
    expect(smooth.latencyP99Ms).toBe(HOLD_MS);
  });

  it('CLAIM: with realistic bursty arrivals at the SAME 90%, requests do queue', () => {
    // Identical pool, identical hold, identical average rate. The only change is that
    // arrivals are independent rather than evenly spaced.
    const bursty = simulate({
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 150,
      durationSeconds: 90, arrivals: 'poisson', seed: 1,
    });

    expect(bursty.utilization).toBeCloseTo(0.9, 2);
    expect(bursty.waitP99Ms).toBeGreaterThan(0);
    expect(bursty.latencyP99Ms).toBeGreaterThan(HOLD_MS);
  });

  it('CLAIM: queueing grows sharply as utilization approaches the ceiling', () => {
    const at = (rps: number) =>
      simulate({
        poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: rps,
        durationSeconds: 90, arrivals: 'poisson', seed: 7,
      });

    const half = at(85);   // ~51% utilized
    const edge = at(163);  // ~98% utilized

    // Not linear in the traffic: the arrival rate not quite doubles, and the wait goes from
    // negligible to substantial. This is the knee.
    expect(edge.waitP99Ms).toBeGreaterThan(half.waitP99Ms);
    expect(edge.waitP99Ms).toBeGreaterThan(50);
  });

  it('CLAIM: past the tipping point the queue has no steady state', () => {
    // Above capacity, waiting time is not merely "high" - it grows with however long you
    // watch. That is the difference between a slow system and a system with no equilibrium,
    // and it is why the graph goes vertical instead of levelling off at a worse number.
    const short = simulate({
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 200,
      durationSeconds: 30, arrivals: 'poisson', seed: 3,
    });
    const long = simulate({
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 200,
      durationSeconds: 90, arrivals: 'poisson', seed: 3,
    });

    expect(short.utilization).toBeGreaterThan(1);
    expect(long.waitP99Ms).toBeGreaterThan(short.waitP99Ms * 2);
  });

  it('the pool is the thing that saturates: peak connections pin to the ceiling', () => {
    const over = simulate({
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 220,
      durationSeconds: 40, arrivals: 'poisson', seed: 5,
    });
    expect(over.peakConnections).toBe(POOL); // every connection busy - the 500/500 state
  });

  it('the simulation is reproducible, so these numbers are reviewable', () => {
    const opts = {
      poolSize: POOL, holdMs: HOLD_MS, arrivalsPerSecond: 150,
      durationSeconds: 30, arrivals: 'poisson' as const, seed: 99,
    };
    expect(simulate(opts)).toEqual(simulate(opts));
  });
});
