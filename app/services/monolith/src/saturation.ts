/**
 * Connection-pool saturation, as arithmetic rather than intuition.
 *
 * Chapter 1's central claim is that the monolith does not degrade gradually — it stays flat
 * and then goes vertical, and the tipping point is predictable before you reach it. That claim
 * rests on Little's Law (Little, 1961): with a fixed pool and a given hold time, sustainable
 * throughput is pool size divided by hold time. Everything below is that law made executable,
 * so the hockey stick in Figure 1.1 can be reproduced rather than asserted.
 *
 * Deliberately dependency-free and deterministic. A seeded simulation that produces the same
 * numbers on every run is worth more here than a statistically fancier one that does not.
 */

/**
 * Sustainable throughput in requests/second for a pool of `poolSize` connections each held
 * for `holdMs`. Above this arrival rate the queue grows without bound and latency is
 * unbounded — it is not "slower", it has no steady state.
 *
 * ShopFlow at Chapter 1: 500 connections, ~3s hold -> ~166 req/s.
 */
export function sustainableThroughput(poolSize: number, holdMs: number): number {
  if (poolSize <= 0 || holdMs <= 0) throw new RangeError('poolSize and holdMs must be positive');
  return (poolSize * 1000) / holdMs;
}

/** Utilization (rho) at a given arrival rate. At >= 1 the system has no steady state. */
export function utilization(arrivalsPerSecond: number, poolSize: number, holdMs: number): number {
  return arrivalsPerSecond / sustainableThroughput(poolSize, holdMs);
}

/**
 * Little's Law rearranged: the average number of connections concurrently in use.
 * ShopFlow's snapshot reports 450 of 500 in use, which this reproduces from the traffic.
 */
export function connectionsInUse(arrivalsPerSecond: number, holdMs: number): number {
  return arrivalsPerSecond * (holdMs / 1000);
}

/**
 * A tiny seeded PRNG (mulberry32). Present so the simulation can be stochastic *and*
 * reproducible: the same seed gives the same numbers on every machine and every run, which is
 * the only way a queueing assertion belongs in a test suite.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How arrivals are spaced.
 *
 * This choice is not a modelling detail — it decides whether the system has a knee at all.
 *
 * - `deterministic`: perfectly even spacing. A D/D/c queue has **zero** queueing below 100%
 *   utilization and unbounded queueing above it. A step function, not a curve.
 * - `poisson`: exponentially distributed gaps, which is what independent users produce. Now
 *   arrivals clump, a clump can exceed the pool even when the average does not, and waiting
 *   time grows as utilization approaches 1.
 *
 * Figure 1.1's knee comes from the second one. That is the substance of the chapter's warning
 * about reading headroom off a dashboard: 90% average utilization is not 10% of headroom,
 * because the average is not what arrives.
 */
export type ArrivalModel = 'deterministic' | 'poisson';

export interface SimResult {
  /** Requests that completed within the observation window. */
  completed: number;
  /** Time spent waiting for a free connection, before the query even starts. */
  waitP50Ms: number;
  waitP99Ms: number;
  /** End-to-end: queue wait plus the query itself. This is what the user experiences. */
  latencyP99Ms: number;
  /** Peak concurrent connections held. Compare against poolSize. */
  peakConnections: number;
  utilization: number;
}

/**
 * A `c`-server queue with a fixed service time of `holdMs`: every request takes a connection
 * for the whole query, which is precisely the property that makes the legacy search route
 * dangerous. Arrival spacing is chosen by `arrivals` — see `ArrivalModel`, because that choice
 * is what decides whether there is a knee.
 */
export function simulate(opts: {
  poolSize: number;
  holdMs: number;
  arrivalsPerSecond: number;
  /** How long to observe, in seconds. */
  durationSeconds: number;
  /** Defaults to `poisson`, the model that reflects independent users. */
  arrivals?: ArrivalModel;
  /** Seed for the arrival process, so runs are reproducible. */
  seed?: number;
}): SimResult {
  const { poolSize, holdMs, arrivalsPerSecond, durationSeconds } = opts;
  const model = opts.arrivals ?? 'poisson';
  const rand = mulberry32(opts.seed ?? 42);
  const meanGapMs = 1000 / arrivalsPerSecond;
  const total = Math.floor(durationSeconds * arrivalsPerSecond);

  /** Exponential inter-arrival gap with the given mean. */
  const nextGap = () =>
    model === 'deterministic' ? meanGapMs : -Math.log(1 - rand()) * meanGapMs;

  // Each slot holds the time a connection next becomes free. A min-heap would be faster; at
  // test sizes a flat array scan is clearer and fast enough.
  const freeAt = new Float64Array(poolSize); // all free at t=0
  const waits: number[] = [];
  let peak = 0;

  let arrival = 0;
  for (let i = 0; i < total; i++) {
    arrival += nextGap();

    // Take the connection that frees up soonest, and count how many are still busy while we
    // are already walking the array.
    let slot = 0;
    let busy = 0;
    for (let s = 0; s < poolSize; s++) {
      const f = freeAt[s]!;
      if (f < freeAt[slot]!) slot = s;
      if (f > arrival) busy++;
    }
    if (busy > peak) peak = busy;

    const start = Math.max(arrival, freeAt[slot]!);
    waits.push(start - arrival);
    freeAt[slot] = start + holdMs;
  }

  waits.sort((a, b) => a - b);
  const at = (q: number) => waits[Math.min(waits.length - 1, Math.floor(waits.length * q))] ?? 0;

  return {
    completed: total,
    waitP50Ms: at(0.5),
    waitP99Ms: at(0.99),
    latencyP99Ms: at(0.99) + holdMs,
    peakConnections: peak,
    utilization: utilization(arrivalsPerSecond, poolSize, holdMs),
  };
}
