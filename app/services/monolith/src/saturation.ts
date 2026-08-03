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
 * A deterministic D/D/c queue: arrivals at a fixed interval, `poolSize` servers, a fixed
 * service time of `holdMs`. Every request takes a connection for the whole query, which is
 * precisely the property that makes the legacy search route dangerous.
 *
 * Deterministic arrivals are the *kindest* possible assumption — real traffic is bursty, which
 * makes the cliff arrive sooner. Chapter 1's point survives the generous model.
 */
export function simulate(opts: {
  poolSize: number;
  holdMs: number;
  arrivalsPerSecond: number;
  /** How long to observe, in seconds. */
  durationSeconds: number;
}): SimResult {
  const { poolSize, holdMs, arrivalsPerSecond, durationSeconds } = opts;
  const intervalMs = 1000 / arrivalsPerSecond;
  const total = Math.floor(durationSeconds * arrivalsPerSecond);

  // Each slot holds the time a connection next becomes free. A min-heap would be faster; at
  // test sizes a flat array scan is clearer and fast enough.
  const freeAt = new Float64Array(poolSize); // all free at t=0
  const waits: number[] = [];
  let peak = 0;

  for (let i = 0; i < total; i++) {
    const arrival = i * intervalMs;

    // Take the connection that frees up soonest.
    let slot = 0;
    for (let s = 1; s < poolSize; s++) {
      if (freeAt[s]! < freeAt[slot]!) slot = s;
    }

    const start = Math.max(arrival, freeAt[slot]!);
    waits.push(start - arrival);
    freeAt[slot] = start + holdMs;

    // Concurrency at this instant: how many connections are still busy.
    let busy = 0;
    for (let s = 0; s < poolSize; s++) if (freeAt[s]! > arrival) busy++;
    if (busy > peak) peak = busy;
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
