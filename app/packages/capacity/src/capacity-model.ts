/**
 * The headroom band, model decay, and scaling readiness.
 *
 * Chapter 13's position on capacity planning is that the model is the cheap part and the scaling
 * procedure is the valuable part. A 12-month forecast with precise hardware lead times is worth less
 * than a scaling procedure that has actually been run.
 */

export const HEADROOM_FLOOR = 1.2;
export const HEADROOM_CEILING = 1.5;

export type HeadroomZone = 'under-provisioned' | 'target-band' | 'over-provisioned';

export interface HeadroomAssessment {
  ratio: number;
  zone: HeadroomZone;
  /** Monthly spend attributable to capacity above the ceiling. Zero inside the band. */
  wasteAboveCeilingUsd: number;
  note: string;
}

export function assessHeadroom(input: {
  provisionedUnits: number;
  measuredPeakUnits: number;
  monthlyCostPerUnitUsd: number;
}): HeadroomAssessment {
  const ratio = input.provisionedUnits / input.measuredPeakUnits;
  const ceilingUnits = input.measuredPeakUnits * HEADROOM_CEILING;
  const excessUnits = Math.max(0, input.provisionedUnits - ceilingUnits);

  const zone: HeadroomZone =
    ratio < HEADROOM_FLOOR ? 'under-provisioned' : ratio > HEADROOM_CEILING ? 'over-provisioned' : 'target-band';

  const notes: Record<HeadroomZone, string> = {
    'under-provisioned': 'one traffic spike away from an incident',
    'target-band': 'absorbs normal variance and buys time to execute a planned scaling event',
    'over-provisioned': 'paying for capacity that is not being used',
  };

  return {
    ratio,
    zone,
    wasteAboveCeilingUsd: excessUnits * input.monthlyCostPerUnitUsd,
    note: notes[zone],
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Model Recalibration Rule.
 *
 * A capacity model is a claim about the future made from last month's telemetry, and it decays. The
 * rule's sharpest line is that a gap in EITHER direction is a signal: a model that keeps
 * under-predicting has missed growth, and one that keeps over-predicting is buying idle capacity on a
 * false premise. Both mean the assumptions have moved.
 */
export const MODEL_INVALIDATORS = [
  'seasonal-traffic-patterns',
  'customer-growth-changing-the-denominator',
  'feature-launch-changing-the-shape-of-peak',
  'infrastructure-change-resetting-what-100-percent-means',
] as const;

export interface Recalibration {
  monthsSinceLastCheck: number;
  /** Predicted vs observed peak for each of the last few months, most recent last. */
  history: { predictedPeak: number; observedPeak: number }[];
}

export type ModelVerdict =
  | { trustworthy: true; meanErrorFraction: number }
  | { trustworthy: false; reason: string; meanErrorFraction: number; direction?: 'under' | 'over' };

export function assessModel(r: Recalibration): ModelVerdict {
  const errors = r.history.map((h) => (h.observedPeak - h.predictedPeak) / h.predictedPeak);
  const meanErrorFraction =
    errors.length === 0 ? 0 : errors.reduce((a, e) => a + e, 0) / errors.length;

  if (r.monthsSinceLastCheck >= 3) {
    return {
      trustworthy: false,
      reason:
        'not checked against reality in a quarter. That is not a plan, it is an assumption with a ' +
        'spreadsheet attached.',
      meanErrorFraction,
    };
  }

  // A consistent gap in either direction. Consistency is what makes it a signal rather than noise.
  const allSameSign = errors.length >= 2 && (errors.every((e) => e > 0.1) || errors.every((e) => e < -0.1));
  if (allSameSign) {
    return {
      trustworthy: false,
      reason:
        'a consistent gap in one direction across every month checked. The assumptions have moved; ' +
        'over-prediction buys idle capacity on a false premise just as under-prediction misses growth.',
      meanErrorFraction,
      direction: meanErrorFraction > 0 ? 'under' : 'over',
    };
  }

  return { trustworthy: true, meanErrorFraction };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Scaling Readiness Mandate: a scaling procedure that has never been executed is a scaling
 * procedure that will fail at the worst moment.
 *
 * Note that `documented` and `scripted` are not sufficient. The mandate requires it to have been RUN,
 * and run recently enough that the environment it was proven against still resembles the one it will
 * run in.
 */
export interface ScalingProcedure {
  service: string;
  tier: 'P0' | 'P1' | 'P2';
  documented: boolean;
  scripted: boolean;
  lastExecutedDaysAgo: number | null;
  measuredExecutionMinutes: number | null;
}

export const MAX_SCALING_MINUTES = 15;
export const MAX_DAYS_SINCE_DRILL = 90;

export type ReadinessVerdict = { ready: true } | { ready: false; reason: string };

export function assessScalingReadiness(p: ScalingProcedure): ReadinessVerdict {
  if (!p.documented) return { ready: false, reason: 'not documented' };
  if (!p.scripted) return { ready: false, reason: 'not scripted: a manual procedure under pressure is a different procedure' };
  if (p.lastExecutedDaysAgo === null) {
    return {
      ready: false,
      reason: 'never executed. A scaling procedure that has never been run is one that will fail at the worst moment.',
    };
  }
  if (p.lastExecutedDaysAgo > MAX_DAYS_SINCE_DRILL) {
    return {
      ready: false,
      reason: `last run ${p.lastExecutedDaysAgo} days ago. The environment it was proven against is not the one it will run in.`,
    };
  }
  if (p.measuredExecutionMinutes === null || p.measuredExecutionMinutes > MAX_SCALING_MINUTES) {
    return {
      ready: false,
      reason: `execution takes ${p.measuredExecutionMinutes ?? 'an unmeasured amount of'} minutes. Scaling must complete in minutes, not hours.`,
    };
  }
  return { ready: true };
}
