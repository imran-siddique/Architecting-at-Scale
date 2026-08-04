/**
 * Experimenting on the architecture, the predictable unit, and the number the chapter does not supply.
 *
 * The Predictable-Unit Rule: scale by replicating a single, characterized unit whose performance you know,
 * rather than tuning ever-larger individual units whose behaviour you must rediscover. Predictability
 * compounds across a fleet; so does unpredictability.
 *
 * The Manager's Math block for this is the only one in Chapters 12 to 16 with no arithmetic in it. It
 * argues, correctly, that the measurable win was not raw speed but the elimination of the over-provisioning
 * that unpredictability forces. That claim has a number, and `overProvisioningFromVariance` computes it:
 * if you must provision against the bad case rather than the average, the buffer you carry is a function of
 * the variance, and a predictable unit carries none of it.
 *
 * This is the closing argument of the book, so it is worth being quantified rather than asserted.
 */

export interface UnitProfile {
  name: string;
  /** Mean capacity per unit, in requests per second. */
  meanCapacityRps: number;
  /** Standard deviation of capacity across units, from measurement. Zero for an identical unit. */
  capacityStdDevRps: number;
  monthlyCostPerUnitUsd: number;
}

export interface ProvisioningPlan {
  unit: string;
  /** Capacity you can actually count on from one unit, at the planning confidence level. */
  dependableCapacityRps: number;
  unitsRequired: number;
  monthlyCostUsd: number;
  /** Units carried purely because capacity varies. Zero for a predictable unit. */
  varianceBufferUnits: number;
  varianceBufferCostUsd: number;
}

/**
 * Provision against the bad case, because that is what capacity planning means.
 *
 * `z` is the planning confidence: 1.65 for the p5 case, which is the usual "we will not be caught short"
 * posture. A unit with zero variance has `dependableCapacity == meanCapacity`, so it needs no buffer, and
 * that is the entire economic argument for the identical unit.
 */
export function plan(unit: UnitProfile, demandRps: number, z = 1.65): ProvisioningPlan {
  const dependableCapacityRps = Math.max(1, unit.meanCapacityRps - z * unit.capacityStdDevRps);
  const unitsRequired = Math.ceil(demandRps / dependableCapacityRps);
  // What you would have needed had the unit been predictable at the same mean.
  const unitsIfPredictable = Math.ceil(demandRps / unit.meanCapacityRps);
  const varianceBufferUnits = unitsRequired - unitsIfPredictable;

  return {
    unit: unit.name,
    dependableCapacityRps,
    unitsRequired,
    monthlyCostUsd: unitsRequired * unit.monthlyCostPerUnitUsd,
    varianceBufferUnits,
    varianceBufferCostUsd: varianceBufferUnits * unit.monthlyCostPerUnitUsd,
  };
}

export interface StrategyComparison {
  scaleUp: ProvisioningPlan;
  scaleOut: ProvisioningPlan;
  /** True when the tuned unit is faster on average, which it usually is. */
  tunedUnitIsFasterOnAverage: boolean;
  cheaperStrategy: 'scale-up' | 'scale-out';
  monthlySavingUsd: number;
  note: string;
}

export function compareStrategies(
  tuned: UnitProfile,
  identical: UnitProfile,
  demandRps: number,
): StrategyComparison {
  const scaleUp = plan(tuned, demandRps);
  const scaleOut = plan(identical, demandRps);
  const cheaperStrategy = scaleOut.monthlyCostUsd <= scaleUp.monthlyCostUsd ? 'scale-out' : 'scale-up';

  return {
    scaleUp,
    scaleOut,
    tunedUnitIsFasterOnAverage: tuned.meanCapacityRps > identical.meanCapacityRps,
    cheaperStrategy,
    monthlySavingUsd: Math.abs(scaleOut.monthlyCostUsd - scaleUp.monthlyCostUsd),
    note:
      'a predictable unit you can plan against is cheaper at scale than a faster one you cannot, because ' +
      'the variance buffer is paid every month and the peak is not.',
  };
}

/** The tuned unit really is faster. That is what makes the trade a trade. */
export const TUNED_UNIT: UnitProfile = {
  name: 'hand-tuned large instance',
  meanCapacityRps: 1_400,
  capacityStdDevRps: 320, // the cost of an unrepeatable configuration
  monthlyCostPerUnitUsd: 620,
};

export const IDENTICAL_UNIT: UnitProfile = {
  name: 'characterized standard unit',
  meanCapacityRps: 1_000,
  capacityStdDevRps: 0,
  monthlyCostPerUnitUsd: 420,
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The Abandonment-Condition Rule: write the condition that would end the experiment before you start it.
 *
 * Two claims here, and the second is the one that changes behaviour.
 *
 * Without a pre-stated condition the decision is made by whoever has invested the most effort, which is the
 * opposite of deciding on evidence.
 *
 * And an experiment that validates the existing design is a SUCCESSFUL experiment. It cost a canary instead
 * of a migration. Recording it as a failure is how a team learns not to run the cheap check.
 */
export interface ExperimentDesign {
  hypothesis: string;
  /** Metrics that must improve, with the threshold for each. */
  mustImprove: { metric: string; byAtLeast: number }[];
  /** Metrics that must not regress, with the tolerance for each. */
  mustNotRegress: { metric: string; toleranceFraction: number }[];
  /** Stated BEFORE the experiment runs. */
  statedBeforeStart: boolean;
}

export interface ExperimentResult {
  measured: Record<string, { before: number; after: number }>;
}

export type Outcome =
  | { outcome: 'adopt'; reason: string }
  | { outcome: 'abandon'; reason: string; validatedExistingDesign: boolean; whatItCost: string }
  | { outcome: 'undecidable'; reason: string };

export function decide(design: ExperimentDesign, result: ExperimentResult): Outcome {
  if (!design.statedBeforeStart) {
    return {
      outcome: 'undecidable',
      reason:
        'the abandonment condition was not stated before the experiment ran, so the decision will be made ' +
        'by whoever has invested the most effort, which is the opposite of deciding on evidence.',
    };
  }

  const regressions: string[] = [];
  for (const r of design.mustNotRegress) {
    const m = result.measured[r.metric];
    if (!m) return { outcome: 'undecidable', reason: `${r.metric} was declared and not measured` };
    const change = (m.after - m.before) / m.before;
    if (change < -r.toleranceFraction) regressions.push(`${r.metric} regressed ${(change * 100).toFixed(1)}%`);
  }

  const shortfalls: string[] = [];
  for (const r of design.mustImprove) {
    const m = result.measured[r.metric];
    if (!m) return { outcome: 'undecidable', reason: `${r.metric} was declared and not measured` };
    const change = (m.after - m.before) / m.before;
    if (change < r.byAtLeast) shortfalls.push(`${r.metric} improved ${(change * 100).toFixed(1)}%, needed ${(r.byAtLeast * 100).toFixed(0)}%`);
  }

  if (regressions.length > 0 || shortfalls.length > 0) {
    return {
      outcome: 'abandon',
      reason: [...regressions, ...shortfalls].join('; '),
      validatedExistingDesign: regressions.length === 0,
      whatItCost:
        'a canary instead of a migration. An experiment that validates the existing design is a ' +
        'successful experiment, and recording it as a failure teaches the team not to run the cheap check.',
    };
  }

  return { outcome: 'adopt', reason: 'every must-improve metric cleared its threshold and nothing declared regressed' };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Reversible-Bet Rule: move fast on changes that are cheap to reverse, and slow down only for the ones
 * that are not.
 *
 * The rule's real content is that the safe-change machinery from stages 2 to 4 is what MOVES a decision
 * from irreversible to reversible. So the same change is a reversible bet or a careful one depending on
 * what the team has built, which is the thread back to the maturity progression.
 */
export interface Change {
  name: string;
  /** Can it be reverted by the machinery, without a migration or a data rewrite? */
  revertibleByMachinery: boolean;
  /** Does it change persisted state in a way a revert cannot undo? */
  writesIrreversibleState: boolean;
}

export function pace(c: Change, hasAutomatedRollback: boolean): { pace: 'fast' | 'careful'; reason: string } {
  if (c.writesIrreversibleState) {
    return { pace: 'careful', reason: 'it writes state a revert cannot undo. No amount of machinery makes this reversible.' };
  }
  if (c.revertibleByMachinery && hasAutomatedRollback) {
    return { pace: 'fast', reason: 'a reversible bet should be taken quickly and learned from, not deliberated' };
  }
  return {
    pace: 'careful',
    reason:
      'reversible in principle and not in practice: without automated rollback, reverting is a human ' +
      'decision under pressure. The machinery is what makes a bet reversible.',
  };
}

/**
 * The Boundaries-Outlast-Technology Rule and the Operator-Agnostic Rule, as a single check.
 *
 * A control that assumes a careful operator is not a control, it is a convention. This is the same test as
 * Chapter 15's runtime-versus-prompt distinction, arriving one layer up: enforce structurally, or the
 * property holds only for the operators you happened to vet.
 */
export interface Boundary {
  name: string;
  /** The thing inside, which will be replaced. */
  currentImplementation: string;
  enforcedStructurally: boolean;
  /** Does safety depend on the operator being careful, senior, or human? */
  assumesCarefulOperator: boolean;
}

export function assessBoundary(b: Boundary): { futureProof: boolean; reason: string } {
  if (!b.enforcedStructurally) {
    return { futureProof: false, reason: `${b.name} is a convention rather than a gate, so it holds until someone does not follow it` };
  }
  if (b.assumesCarefulOperator) {
    return {
      futureProof: false,
      reason:
        `${b.name} assumes a careful operator. Build for the operator you cannot vet in advance: a new ` +
        `engineer, a senior one, or an autonomous agent.`,
    };
  }
  return {
    futureProof: true,
    reason: `${b.name} is enforced structurally and does not care who or what changes ${b.currentImplementation}, which will be replaced.`,
  };
}
