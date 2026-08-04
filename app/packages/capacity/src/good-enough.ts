/**
 * Good enough, and why percentage improvement is the wrong metric.
 *
 * The chapter's two ShopFlow examples are chosen so that the LESS valuable one has the larger
 * percentage improvement, which makes the point better than any argument does:
 *
 *   checkout 900ms -> 300ms   67% faster, worth doing
 *   analytics 3h -> 2h        33% faster, not worth doing
 *
 * The smaller percentage is the one worth doing. Percentage improvement is a benchmark metric, not a
 * business one, and the question is never how much faster it got but whether anyone can tell.
 */

/** Below this, latency differences are not perceptible to a person waiting on a response. */
export const PERCEPTIBILITY_FLOOR_MS = 100;

export interface Optimization {
  component: string;
  beforeMs: number;
  afterMs: number;
  /** The threshold that constitutes good enough for this component. */
  goodEnoughMs: number;
  /** Whether a person is waiting on this result. */
  userFacing: boolean;
  engineeringWeeks: number;
}

export interface Judgement {
  component: string;
  percentImprovement: number;
  absoluteSavingMs: number;
  /** True when a user could actually notice the difference. */
  perceptible: boolean;
  alreadyGoodEnough: boolean;
  worthDoing: boolean;
  reason: string;
}

export function judge(o: Optimization): Judgement {
  const absoluteSavingMs = o.beforeMs - o.afterMs;
  const percentImprovement = (absoluteSavingMs / o.beforeMs) * 100;
  const alreadyGoodEnough = o.beforeMs <= o.goodEnoughMs;

  // Perceptibility has two parts: is anyone waiting, and is the change above the floor. An improvement
  // that lands entirely below the floor is invisible however large the percentage.
  const perceptible =
    o.userFacing && absoluteSavingMs >= PERCEPTIBILITY_FLOOR_MS && o.beforeMs > PERCEPTIBILITY_FLOOR_MS;

  if (alreadyGoodEnough) {
    return {
      component: o.component,
      percentImprovement,
      absoluteSavingMs,
      perceptible,
      alreadyGoodEnough: true,
      worthDoing: false,
      reason:
        `already inside its good-enough threshold at ${o.beforeMs}ms against ${o.goodEnoughMs}ms. ` +
        `Further optimization here is the Perfection Trap: the engineering weeks are real and the ` +
        `improvement is not experienced by anyone.`,
    };
  }

  if (!perceptible) {
    return {
      component: o.component,
      percentImprovement,
      absoluteSavingMs,
      perceptible: false,
      alreadyGoodEnough: false,
      worthDoing: false,
      reason: o.userFacing
        ? `a ${absoluteSavingMs}ms saving is below the ${PERCEPTIBILITY_FLOOR_MS}ms perceptibility floor. Nobody can tell.`
        : `nobody is waiting on this result, so ${percentImprovement.toFixed(0)}% faster is ${percentImprovement.toFixed(0)}% of nothing anyone experiences.`,
    };
  }

  return {
    component: o.component,
    percentImprovement,
    absoluteSavingMs,
    perceptible: true,
    alreadyGoodEnough: false,
    worthDoing: true,
    reason: `${absoluteSavingMs}ms off a user-facing path that was outside its threshold. Every millisecond of it is perceptible.`,
  };
}

export const SHOPFLOW_OPTIMIZATIONS: Optimization[] = [
  // Worth doing. 67%.
  { component: 'checkout', beforeMs: 900, afterMs: 300, goodEnoughMs: 400, userFacing: true, engineeringWeeks: 4 },
  // Not worth doing. 33%, against a 24-hour SLO, with nobody waiting.
  {
    component: 'analytics-batch',
    beforeMs: 3 * 3_600_000,
    afterMs: 2 * 3_600_000,
    goodEnoughMs: 24 * 3_600_000,
    userFacing: false,
    engineeringWeeks: 3,
  },
  // Not worth doing. Already inside the threshold, and the saving is imperceptible either way.
  {
    component: 'search-ranking',
    beforeMs: 35,
    afterMs: 20,
    goodEnoughMs: 50,
    userFacing: true,
    engineeringWeeks: 3,
  },
];

/* ------------------------------------------------------------------------------------------- */

/**
 * The opportunity cost of an imperceptible optimization.
 *
 * The chapter's framing is the one that matters: the business value of an imperceptible improvement is
 * approximately zero, and the business value of a user-perceptible feature is determined by the
 * product team. That is the only comparison there is, so this function refuses to invent the other
 * side of it.
 */
export interface OpportunityCost {
  component: string;
  engineeringWeeks: number;
  costUsd: number;
  valueOfTheOptimizationUsd: number;
  comparison: string;
}

export function opportunityCost(o: Optimization, loadedWeeklyRateUsd: number): OpportunityCost {
  const j = judge(o);
  return {
    component: o.component,
    engineeringWeeks: o.engineeringWeeks,
    costUsd: o.engineeringWeeks * loadedWeeklyRateUsd,
    valueOfTheOptimizationUsd: j.worthDoing ? Number.NaN : 0,
    comparison: j.worthDoing
      ? 'this one is perceptible, so it competes on its own merits rather than against the backlog'
      : `${o.engineeringWeeks} weeks against a change nobody can perceive. The comparison is not ` +
        `optimization-versus-nothing, it is these weeks against the next feature, and the value of ` +
        `that feature is the product team's number to supply.`,
  };
}

/**
 * The Iterative Optimization Rule: ship at good enough, optimize the second version on real usage
 * data, fix what scale exposed in the third. The sequence is the point, because the bottlenecks that
 * matter are the ones production reveals and a pre-launch guess is unlikely to name them.
 */
export const ITERATIVE_SEQUENCE = ['ship-at-good-enough', 'optimize-on-real-usage', 'fix-what-scale-exposed'] as const;

export function nextStep(versionsShipped: number): (typeof ITERATIVE_SEQUENCE)[number] | 'steady-state' {
  return ITERATIVE_SEQUENCE[versionsShipped] ?? 'steady-state';
}
