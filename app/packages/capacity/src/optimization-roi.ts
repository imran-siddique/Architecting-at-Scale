/**
 * The Hardware-First Rule, and the crossover figure the manuscript reads backwards.
 *
 * Chapter 13 runs the hardware-versus-optimization decision as four sequential questions, and the
 * order matters because each one can end the exercise before the next is asked. Three of the five
 * exits do not involve writing optimization code, which is the point of the framework: the default
 * outcome of an honest performance review is usually to provision or to accept.
 */

export type Bottleneck =
  | 'cpu'
  | 'memory'
  | 'iops'
  // Algorithm-bound. Hardware does not help.
  | 'quadratic-algorithm'
  | 'lock-contention'
  | 'query-plan'
  | 'network-round-trips'
  | 'serialisation-point';

/** Resource-bound bottlenecks are the only ones with a hardware lever. */
export const RESOURCE_BOUND: readonly Bottleneck[] = ['cpu', 'memory', 'iops'];

export function isResourceBound(b: Bottleneck): boolean {
  return RESOURCE_BOUND.includes(b);
}

/**
 * The Resource-Bound Precondition, stated as the empirical test rather than as a category.
 *
 * The chapter's version: if the workload does not get proportionally faster on a larger instance,
 * the bottleneck is not the resource you enlarged. This matters because a team can misclassify a
 * lock as a CPU problem and buy bigger boxes for a year.
 */
export function confirmResourceBound(measured: {
  /** Ratio of new capacity to old, e.g. 2 for double the cores. */
  capacityMultiple: number;
  /** Ratio of new throughput to old on the larger instance. */
  observedThroughputMultiple: number;
}): { resourceBound: boolean; note: string } {
  const { capacityMultiple, observedThroughputMultiple } = measured;
  // Doubling hardware on an O(n^2) routine buys a 41% increase in workable n, not 100%.
  const proportional = observedThroughputMultiple >= 1 + (capacityMultiple - 1) * 0.7;
  return {
    resourceBound: proportional,
    note: proportional
      ? `throughput scaled ${observedThroughputMultiple}x on ${capacityMultiple}x capacity: a hardware lever exists`
      : `throughput scaled only ${observedThroughputMultiple}x on ${capacityMultiple}x capacity: ` +
        `the bottleneck is not the resource you enlarged, so hardware will not resolve it`,
  };
}

export interface DecisionInput {
  meetingSlo: boolean;
  bottleneck: Bottleneck;
  hardwareMonthlyDeltaUsd: number | null; // null when no hardware path exists at any acceptable cost
  optimizationWeeks: number;
  loadedWeeklyRateUsd: number;
}

export type Exit =
  | 'no-problem-only-a-preference'
  | 'optimize-hardware-cannot-help'
  | 'provision-hardware'
  | 'optimize-hardware-is-more-expensive'
  | 'optimize-no-hardware-path-exists';

export interface Decision {
  exit: Exit;
  /** True when the exit involves writing optimization code. */
  requiresOptimizationWork: boolean;
  twelveMonthHardwareUsd: number | null;
  optimizationCostUsd: number;
  reason: string;
}

/**
 * The four questions, in order. Each can end the exercise.
 */
export function decide(input: DecisionInput): Decision {
  const optimizationCostUsd = input.optimizationWeeks * input.loadedWeeklyRateUsd;
  const twelveMonthHardwareUsd =
    input.hardwareMonthlyDeltaUsd === null ? null : input.hardwareMonthlyDeltaUsd * 12;

  // 1. Is the workload meeting its SLO?
  if (input.meetingSlo) {
    return {
      exit: 'no-problem-only-a-preference',
      requiresOptimizationWork: false,
      twelveMonthHardwareUsd,
      optimizationCostUsd,
      reason:
        'the workload meets its SLO. There is no performance problem, there is a performance ' +
        'preference, and it is competing with the feature backlog for the same engineering weeks.',
    };
  }

  // 2. Is the bottleneck resource-bound?
  if (!isResourceBound(input.bottleneck)) {
    return {
      exit: 'optimize-hardware-cannot-help',
      requiresOptimizationWork: true,
      twelveMonthHardwareUsd,
      optimizationCostUsd,
      reason: `${input.bottleneck} is algorithm-bound. Hardware will not resolve it at any price, so the economic comparison does not apply.`,
    };
  }

  // 4. (asked here because it gates 3) Is a hardware path available at all?
  if (twelveMonthHardwareUsd === null) {
    return {
      exit: 'optimize-no-hardware-path-exists',
      requiresOptimizationWork: true,
      twelveMonthHardwareUsd: null,
      optimizationCostUsd,
      reason:
        'no hardware path exists at an acceptable cost. Optimization is not the economic choice here, ' +
        'it is the only choice.',
    };
  }

  // 3. Is the 12-month hardware cost lower than the engineering cost?
  if (twelveMonthHardwareUsd < optimizationCostUsd) {
    return {
      exit: 'provision-hardware',
      requiresOptimizationWork: false,
      twelveMonthHardwareUsd,
      optimizationCostUsd,
      reason: `12 months of hardware ($${twelveMonthHardwareUsd.toLocaleString()}) costs less than the optimization ($${optimizationCostUsd.toLocaleString()}). Provision.`,
    };
  }

  return {
    exit: 'optimize-hardware-is-more-expensive',
    requiresOptimizationWork: true,
    twelveMonthHardwareUsd,
    optimizationCostUsd,
    reason: `12 months of hardware ($${twelveMonthHardwareUsd.toLocaleString()}) costs more than the optimization ($${optimizationCostUsd.toLocaleString()}). Optimize.`,
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The crossover between recurring hardware spend and one-time engineering spend.
 *
 * The manuscript computes $20,000 / $800 = 25 months and then says "Option A pays back in less than
 * 2 years". Two things are wrong with that sentence.
 *
 * First, 25 months is more than two years.
 *
 * Second, and more importantly, the direction is inverted. Option A (the dedicated node pool) is the
 * RECURRING cost and Option B (the optimization) is the ONE-TIME cost, so 25 months is not when
 * Option A pays back. It is the month at which Option A has cost more than Option B ever would, which
 * is when it stops being the cheaper choice. Nothing is being paid back; a meter is running.
 *
 * The recommendation is still right, because the Hardware-First Rule tests the TWELVE-month hardware
 * cost against the engineering cost, and $9,600 is comfortably under $20,000. The rule is a 12-month
 * test precisely so that a 25-month crossover does not need to be interpreted.
 */
export interface CrossoverInput {
  recurringMonthlyUsd: number;
  oneTimeUsd: number;
}

export interface Crossover {
  months: number;
  /** Recurring cost accumulated at 12 months, which is what the rule actually compares. */
  twelveMonthRecurringUsd: number;
  cheaperAtTwelveMonths: 'recurring' | 'one-time';
  interpretation: string;
}

export function crossover(input: CrossoverInput): Crossover {
  const months = input.oneTimeUsd / input.recurringMonthlyUsd;
  const twelveMonthRecurringUsd = input.recurringMonthlyUsd * 12;

  return {
    months,
    twelveMonthRecurringUsd,
    cheaperAtTwelveMonths: twelveMonthRecurringUsd < input.oneTimeUsd ? 'recurring' : 'one-time',
    interpretation:
      `month ${months.toFixed(0)} is when the recurring option has cost more than the one-time option ` +
      `ever would. It is the month the recurring choice STOPS being cheaper, not a payback date: the ` +
      `recurring option never pays back, it accrues.`,
  };
}
