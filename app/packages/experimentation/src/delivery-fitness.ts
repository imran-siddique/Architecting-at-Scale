/**
 * Delivery metrics as evolutionary fitness.
 *
 * The Delivery-Fitness Rule: treat deployment frequency, lead time, change failure rate and time to
 * restore as the system's evolutionary fitness, and review them as seriously as availability.
 *
 * The line worth making executable: health metrics describe the system at rest, delivery metrics describe
 * its ability to change, and a system that scores well at rest and badly on delivery is not healthy, it is
 * stagnant. Stagnation stays invisible until you measure the right thing, which is exactly ShopFlow's
 * Panic Meter reading 2 out of 10.
 */

export interface HealthMetrics {
  availability: number;
  journeySuccessRate: number;
  p99LatencyMs: number;
  slosMet: boolean;
}

export interface DeliveryMetrics {
  deploymentsPerMonth: number;
  leadTimeDays: number;
  changeFailureRate: number;
  timeToRestoreHours: number;
}

export type FitnessVerdict = 'healthy' | 'stagnant' | 'unstable' | 'failing';

export interface Assessment {
  verdict: FitnessVerdict;
  healthLooksGood: boolean;
  deliveryLooksGood: boolean;
  note: string;
}

/** Thresholds. Deliberately modest: this is the line between changing and not changing, not elite delivery. */
export const MIN_DEPLOYS_PER_MONTH = 4;
export const MAX_LEAD_TIME_DAYS = 7;
export const MAX_CHANGE_FAILURE_RATE = 0.15;
export const MAX_TIME_TO_RESTORE_HOURS = 4;

export function assessFitness(h: HealthMetrics, d: DeliveryMetrics): Assessment {
  const healthLooksGood = h.slosMet && h.availability >= 0.999 && h.journeySuccessRate >= 0.995;
  const deliveryLooksGood =
    d.deploymentsPerMonth >= MIN_DEPLOYS_PER_MONTH &&
    d.leadTimeDays <= MAX_LEAD_TIME_DAYS &&
    d.changeFailureRate <= MAX_CHANGE_FAILURE_RATE &&
    d.timeToRestoreHours <= MAX_TIME_TO_RESTORE_HOURS;

  const verdict: FitnessVerdict = healthLooksGood
    ? deliveryLooksGood
      ? 'healthy'
      : 'stagnant'
    : deliveryLooksGood
      ? 'unstable'
      : 'failing';

  const notes: Record<FitnessVerdict, string> = {
    healthy: 'sound at rest and able to change',
    stagnant:
      'every health metric reads green and the system cannot change safely. This is not healthy, it is ' +
      'stagnant, and it stays invisible until you measure the right thing.',
    unstable: 'changing quickly and not holding its SLOs',
    failing: 'neither dependable nor able to change',
  };

  return { verdict, healthLooksGood, deliveryLooksGood, note: notes[verdict] };
}

export const SHOPFLOW_HEALTH: HealthMetrics = {
  availability: 0.999,
  journeySuccessRate: 0.997,
  p99LatencyMs: 95,
  slosMet: true,
};

export const SHOPFLOW_DELIVERY: DeliveryMetrics = {
  deploymentsPerMonth: 1, // down from ~30 at peak
  leadTimeDays: 21,
  changeFailureRate: 0.22,
  timeToRestoreHours: 3,
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The cost of standing still, which is not on the cloud bill.
 *
 * A competitor shipping weekly iterates roughly four times for every one ShopFlow release. The compounding
 * is the argument: it is not a 4x gap in features shipped, it is a 4x gap in learning cycles completed,
 * and the second one does not close by shipping harder later.
 */
export interface IterationGap {
  ourCyclesPerYear: number;
  theirCyclesPerYear: number;
  ratio: number;
  /** Cycles they complete while we complete one. */
  cyclesPerOurs: number;
  note: string;
}

export function iterationGap(ourDeploysPerMonth: number, theirDeploysPerMonth: number): IterationGap {
  const ours = ourDeploysPerMonth * 12;
  const theirs = theirDeploysPerMonth * 12;
  return {
    ourCyclesPerYear: ours,
    theirCyclesPerYear: theirs,
    ratio: theirs / ours,
    cyclesPerOurs: theirDeploysPerMonth / ourDeploysPerMonth,
    note:
      'the gap is in learning cycles completed, not features shipped. A feature gap closes by shipping ' +
      'more; a learning gap does not, because the decisions we have not yet tested are the ones they ' +
      'already have evidence about.',
  };
}

/**
 * Which delivery metric to attack first.
 *
 * Worth encoding because the intuitive answer is deployment frequency, and it is the wrong one. Frequency
 * is an OUTCOME of the other three: a team with a 22% change failure rate and a three-week lead time
 * cannot deploy weekly by deciding to. The change failure rate is what makes people cautious, and caution
 * is what produced the release window.
 */
export function firstMetricToAttack(d: DeliveryMetrics): { metric: keyof DeliveryMetrics; reason: string } {
  if (d.changeFailureRate > MAX_CHANGE_FAILURE_RATE) {
    return {
      metric: 'changeFailureRate',
      reason:
        `a ${(d.changeFailureRate * 100).toFixed(0)}% failure rate is what makes people cautious, and ` +
        `caution is what produced the release window. Deployment frequency is an outcome of this, not a ` +
        `lever you pull directly.`,
    };
  }
  if (d.timeToRestoreHours > MAX_TIME_TO_RESTORE_HOURS) {
    return { metric: 'timeToRestoreHours', reason: 'until recovery is fast, a failed change is an incident rather than a revert' };
  }
  if (d.leadTimeDays > MAX_LEAD_TIME_DAYS) {
    return { metric: 'leadTimeDays', reason: 'the batch size is the problem: a three-week queue makes every release large, and large releases fail more' };
  }
  return { metric: 'deploymentsPerMonth', reason: 'the machinery is sound, so frequency is now a choice' };
}
