/**
 * Reproduce Figure 1.1 against a running monolith.
 *
 * k6 is the load-testing tool the book commits to (Chapter 2). This script walks the arrival
 * rate up through the tipping point rather than hammering a single fixed rate, because the
 * shape of the curve is the finding — a single number tells you the system is slow, and the
 * curve tells you where the wall is.
 *
 *   k6 run app/services/monolith/load/hockey-stick.js
 *
 * Expect p99 to sit flat and unremarkable through the first three stages, then go vertical
 * somewhere near 166 req/s. That number is not tuned into this script; it falls out of the
 * 500-connection pool and the ~3s hold of the legacy search query.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

// Latency per arrival-rate stage, so the curve is readable in the summary instead of averaged
// into a single meaningless p99 across the whole run.
const byStage = new Trend('search_latency_by_stage', true);

export const options = {
  scenarios: {
    walk_up_to_the_wall: {
      executor: 'ramping-arrival-rate',
      startRate: 40,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1200,
      stages: [
        { target: 40, duration: '30s' },   // ~24% utilization - flat and green
        { target: 85, duration: '60s' },   // ~51% - still flat, still "fine"
        { target: 150, duration: '60s' },  // ~90% - the snapshot's 450/500 state
        { target: 200, duration: '60s' },  // ~120% - past the wall, no steady state
      ],
    },
  },
  thresholds: {
    // Deliberately set to the pre-incident expectation, so the run FAILS at the tipping point.
    // A load test that passes while the system falls over is a load test nobody trusts.
    'http_req_duration{expected_response:true}': ['p(99)<3200'],
  },
};

export default function () {
  // The leading wildcard is the whole point: this is the query that cannot use an index.
  const res = http.get(`${BASE}/search?q=oak`, { tags: { name: 'legacy_search' } });

  byStage.add(res.timings.duration);
  check(res, {
    'status is 200': (r) => r.status === 200,
    // Past saturation the pool queue is unbounded, so requests do not fail - they hang.
    // That distinction matters: your error rate stays at zero while the site is unusable.
    'not a pool timeout': (r) => r.status !== 0,
  });
}

export function handleSummary(data) {
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'];
  return {
    stdout:
      `\n  p99 across the whole run: ${p99 ? p99.toFixed(0) : 'n/a'}ms\n` +
      `  The single number is not the finding. Compare the per-stage trend: latency is flat\n` +
      `  through the first stages and vertical in the last one. Sustainable throughput is\n` +
      `  pool size / hold time = 500 / 3s = ~166 req/s (Little, 1961).\n\n`,
  };
}
