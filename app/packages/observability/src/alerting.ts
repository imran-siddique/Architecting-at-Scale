/**
 * Alert volume arithmetic, alert rationalization, and the automation trust ladder.
 *
 * ShopFlow starts Chapter 11 at 400 alerts an hour, of which 10 to 15% are actionable. The number
 * that matters is not the volume, it is what the volume implies about whether anyone is reading
 * them, and that calculation went wrong in an instructive way during review.
 */

/* -------------------------------------------------------------------------------------------
 * The triage arithmetic
 *
 * 400 alerts/hour at 8 minutes each is 53 engineer-hours of triage PER HOUR. The manuscript
 * originally treated the recovered portion of that as headcount, describing 48 engineer-hours per
 * hour as "six engineers' full working capacity". It is not: 48 engineer-hours per hour is 48
 * full-time engineers, off by roughly an order of magnitude.
 *
 * The correct reading is that 53 engineer-hours per hour is THE FINDING. The volume is
 * unprocessable, which is precisely why alerts get ignored, and why the 10 to 15% that are
 * actionable get ignored along with them. Recovered capacity has to be measured against what the
 * rotation actually loses, not against the theoretical triage cost of every alert fired.
 * ------------------------------------------------------------------------------------------- */

export interface AlertLoad {
  alertsPerHour: number;
  minutesPerTriage: number;
  actionableFraction: number;
}

export interface TriageFinding {
  /** Engineer-hours of triage implied per hour of wall-clock time. */
  engineerHoursPerHour: number;
  /** The same figure as full-time engineers, which is the sanity check that was missing. */
  impliedFullTimeEngineers: number;
  /** True when the load exceeds any plausible rotation, so the alerts are certainly not all read. */
  unprocessable: boolean;
  interpretation: string;
}

export function assessTriageLoad(load: AlertLoad): TriageFinding {
  const engineerHoursPerHour = (load.alertsPerHour * load.minutesPerTriage) / 60;
  return {
    engineerHoursPerHour,
    impliedFullTimeEngineers: engineerHoursPerHour,
    unprocessable: engineerHoursPerHour > 5,
    interpretation:
      engineerHoursPerHour > 5
        ? `${engineerHoursPerHour.toFixed(0)} engineer-hours of triage per hour would require ` +
          `${engineerHoursPerHour.toFixed(0)} full-time engineers. Nobody is staffing that, so the ` +
          `alerts are not being read, and the ${(load.actionableFraction * 100).toFixed(0)}% that ` +
          `are actionable are being ignored with the rest. That is the finding.`
        : 'the volume is within what the rotation can process',
  };
}

/**
 * Recovered capacity, measured against the rotation rather than against the theoretical cost.
 *
 * This is the honest calculation, and the assumptions are stated inline so they can be substituted
 * rather than inherited.
 */
export interface RotationCost {
  engineersOnRotation: number;
  onCallDaysPerEngineerPerMonth: number;
  triageHoursPerOnCallDay: number;
}

export interface CapacityRecovered {
  engineerHoursPerMonthLost: number;
  engineerHoursPerMonthRecovered: number;
  /** As a share of one full-time engineer, at roughly 160 hours a month. */
  fullTimeEquivalent: number;
  annualValueUsd: number;
}

export function recoveredCapacity(
  rotation: RotationCost,
  reductionFraction: number,
  loadedCostPerEngineerYearUsd = 180_000,
): CapacityRecovered {
  const lost =
    rotation.engineersOnRotation *
    rotation.onCallDaysPerEngineerPerMonth *
    rotation.triageHoursPerOnCallDay;
  const recovered = lost * reductionFraction;
  const fte = recovered / 160;
  return {
    engineerHoursPerMonthLost: lost,
    engineerHoursPerMonthRecovered: recovered,
    fullTimeEquivalent: fte,
    annualValueUsd: Math.round(fte * loadedCostPerEngineerYearUsd),
  };
}

/* -------------------------------------------------------------------------------------------
 * The Rationalization Ratchet
 *
 * Never suppress without 30 days of evidence. One category per cycle. Validate before proceeding.
 *
 * A ratchet because each step is hard to reverse: once a category is suppressed, the evidence that
 * it mattered stops arriving. So the gate is on the way in, not on the way out.
 * ------------------------------------------------------------------------------------------- */

export interface SuppressionProposal {
  category: string;
  daysOfEvidence: number;
  firedCount: number;
  actionedCount: number;
  /** Categories suppressed in this cycle already. */
  alreadySuppressedThisCycle: string[];
  /** Whether the previous cycle's suppression was validated before this one was proposed. */
  previousCycleValidated: boolean;
}

export type RatchetVerdict =
  | { allow: true }
  | { allow: false; reason: 'insufficient-evidence' | 'more-than-one-per-cycle' | 'previous-not-validated' | 'still-actionable'; detail: string };

export const MIN_EVIDENCE_DAYS = 30;

export function evaluateSuppression(p: SuppressionProposal): RatchetVerdict {
  if (p.daysOfEvidence < MIN_EVIDENCE_DAYS) {
    return {
      allow: false,
      reason: 'insufficient-evidence',
      detail: `${p.daysOfEvidence} days of evidence, ${MIN_EVIDENCE_DAYS} required: a category that is quiet for a week may be seasonal`,
    };
  }
  if (!p.previousCycleValidated) {
    return {
      allow: false,
      reason: 'previous-not-validated',
      detail: 'the previous cycle has not been validated, so its effect on signal is unknown',
    };
  }
  if (p.alreadySuppressedThisCycle.length > 0) {
    return {
      allow: false,
      reason: 'more-than-one-per-cycle',
      detail:
        `${p.alreadySuppressedThisCycle.join(', ')} was already suppressed this cycle. ` +
        `Two at once means you cannot attribute a missed incident to either.`,
    };
  }
  if (p.actionedCount > 0) {
    return {
      allow: false,
      reason: 'still-actionable',
      detail: `${p.actionedCount} of ${p.firedCount} were actioned, so this category still carries signal`,
    };
  }
  return { allow: true };
}

/* -------------------------------------------------------------------------------------------
 * The Automation Trust Ladder
 *
 * Three rungs by blast radius. Each must run unattended and correctly before the next is enabled,
 * because automated remediation without verified signal is action the system cannot confirm.
 * ------------------------------------------------------------------------------------------- */

export interface Rung {
  level: 1 | 2 | 3;
  name: string;
  blastRadius: string;
  /** Consecutive unattended days required before the next rung may be enabled. */
  unattendedDaysRequired: number;
}

export const TRUST_LADDER: Rung[] = [
  { level: 1, name: 'diagnose-and-report', blastRadius: 'none: it writes a summary', unattendedDaysRequired: 14 },
  { level: 2, name: 'remediate-reversibly', blastRadius: 'one instance, reversible in seconds', unattendedDaysRequired: 30 },
  { level: 3, name: 'remediate-with-state-change', blastRadius: 'a service, requires a rollback path', unattendedDaysRequired: 90 },
];

export interface LadderState {
  highestEnabled: 0 | 1 | 2 | 3;
  /** Consecutive unattended days achieved at the highest enabled rung. */
  unattendedDaysAtCurrent: number;
  /** Interventions required at the current rung. Any at all resets the count. */
  interventionsAtCurrent: number;
}

export function mayEnableNextRung(state: LadderState): { allow: boolean; reason: string } {
  if (state.highestEnabled === 3) return { allow: false, reason: 'already at the highest rung' };

  const next = TRUST_LADDER[state.highestEnabled]!;
  const required = state.highestEnabled === 0 ? 0 : TRUST_LADDER[state.highestEnabled - 1]!.unattendedDaysRequired;

  if (state.interventionsAtCurrent > 0) {
    return {
      allow: false,
      reason: `${state.interventionsAtCurrent} intervention(s) at the current rung: the count restarts, because an automation needing help has not run unattended`,
    };
  }
  if (state.unattendedDaysAtCurrent < required) {
    return {
      allow: false,
      reason: `${state.unattendedDaysAtCurrent} of ${required} unattended days at the current rung`,
    };
  }
  return { allow: true, reason: `ready to enable ${next.name} (${next.blastRadius})` };
}
