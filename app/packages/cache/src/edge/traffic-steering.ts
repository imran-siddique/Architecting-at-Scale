/**
 * Figure 4.3: Baby-Step Traffic Steering.
 *
 * Chapter 4's Baby-Step Steering Rule: when moving traffic between regions, never flip a 100%
 * switch. Move in steps, 1%, 3%, 10%, 30%, watching telemetry at each one, so you find out the
 * secondary region cannot take the load while only 1% of customers are affected rather than all
 * of them.
 *
 * The reason this is a *rule* rather than advice is in the arithmetic below: the point of a small
 * first step is not that it is cautious, it is that it bounds the number of people who experience
 * the failure you are looking for. A 1% step that fails costs 1% of requests. A 100% flip that
 * fails costs the business.
 *
 * This is the same shape as Chapter 16's canary release, which is worth noticing: the safe-change
 * primitive shows up here for regional failover, again for feature rollout, and again for
 * architectural experiments. Chapter 16's argument is that they were always the same mechanism.
 */

/** The canonical ladder from the chapter. Never start above the first rung. */
export const BABY_STEPS = [1, 3, 10, 30, 100] as const;

export interface RegionHealth {
  /** p99 latency observed in the target region at the current weight. */
  p99Ms: number;
  /** Error rate as a fraction, 0..1. */
  errorRate: number;
}

export interface SteeringBudget {
  maxP99Ms: number;
  maxErrorRate: number;
}

export type StepOutcome =
  | { action: 'advance'; from: number; to: number }
  | { action: 'hold'; at: number }
  | { action: 'rollback'; from: number; to: number; breached: Array<keyof RegionHealth> }
  | { action: 'complete'; at: 100 };

export interface ShiftResult {
  /** Final weight sent to the target region. */
  finalWeight: number;
  steps: StepOutcome[];
  /** True if the shift reached 100% without a rollback. */
  completed: boolean;
  /**
   * Share of requests that hit a breached state, assuming even traffic across the shift.
   * This is the number the rule exists to keep small.
   */
  requestsExposed: number;
}

/**
 * Walk the ladder, checking health at each rung.
 *
 * `observe(weight)` reports the target region's health at that weight, in production this reads
 * the observability signals from Chapter 11; here it is injected so the behaviour is testable.
 *
 * On a breach the shift rolls back to the previous rung rather than to zero. Rolling all the way
 * back discards the information that the earlier weight was healthy, and on a real failover you
 * usually still need somewhere to send traffic.
 */
export function shiftTraffic(opts: {
  budget: SteeringBudget;
  observe: (weight: number) => RegionHealth;
  steps?: readonly number[];
}): ShiftResult {
  const ladder = opts.steps ?? BABY_STEPS;
  const steps: StepOutcome[] = [];
  let current = 0;
  let exposed = 0;

  for (const target of ladder) {
    const health = opts.observe(target);
    const breached: Array<keyof RegionHealth> = [];
    if (health.p99Ms > opts.budget.maxP99Ms) breached.push('p99Ms');
    if (health.errorRate > opts.budget.maxErrorRate) breached.push('errorRate');

    if (breached.length > 0) {
      // The breach happened AT this weight, so that is the share of traffic exposed to it.
      exposed += target / 100;
      steps.push({ action: 'rollback', from: target, to: current, breached });
      return {
        finalWeight: current,
        steps,
        completed: false,
        requestsExposed: exposed,
      };
    }

    steps.push(
      target === 100 ? { action: 'complete', at: 100 } : { action: 'advance', from: current, to: target },
    );
    current = target;
  }

  return { finalWeight: current, steps, completed: true, requestsExposed: exposed };
}

/**
 * What a single 100% flip would have cost, for comparison.
 *
 * Not a straw man; it is what a DNS change or a load-balancer weight edit does by default, and
 * it is what "we failed over to the secondary region" usually means in an incident review.
 */
export function bigBangShift(opts: {
  budget: SteeringBudget;
  observe: (weight: number) => RegionHealth;
}): ShiftResult {
  const health = opts.observe(100);
  const breached: Array<keyof RegionHealth> = [];
  if (health.p99Ms > opts.budget.maxP99Ms) breached.push('p99Ms');
  if (health.errorRate > opts.budget.maxErrorRate) breached.push('errorRate');

  if (breached.length > 0) {
    return {
      finalWeight: 0,
      steps: [{ action: 'rollback', from: 100, to: 0, breached }],
      completed: false,
      requestsExposed: 1, // every request, which is the entire point
    };
  }
  return {
    finalWeight: 100,
    steps: [{ action: 'complete', at: 100 }],
    completed: true,
    requestsExposed: 0,
  };
}
