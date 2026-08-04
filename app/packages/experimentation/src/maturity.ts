/**
 * The experimentation maturity progression, and why the order is fixed by dependency.
 *
 * ShopFlow enters Chapter 16 with nothing broken, which is the problem. Deployment frequency has fallen
 * from daily to monthly, lead time is three weeks, the change failure rate is 22%, the architecture has
 * not moved in seven months, and there are zero experiments running. The Panic Meter reads 2 out of 10,
 * which is the wrong kind of calm.
 *
 * The Progression-Is-Ordered Rule: each stage supplies what the next one requires. Skipping a stage does
 * not accelerate the practice, it produces the appearance of the later capability without the mechanism
 * underneath it.
 *
 * The most common place to stall is stage two, where flags accumulate because nothing downstream ever
 * forces them to resolve. That is not a coincidence and it is not a discipline problem: canaries and
 * automated rollback are what create the pressure to resolve a flag, so a team that stops at flags has
 * removed its own forcing function.
 */

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;

export interface StageSpec {
  stage: Stage;
  name: string;
  whatHappens: string;
  /** What this stage supplies to the one after it. */
  supplies: string;
  /** The capability a team believes it has if it skips straight here. */
  requires: Stage | null;
}

export const PROGRESSION: readonly StageSpec[] = [
  {
    stage: 1,
    name: 'manual deployments',
    whatHappens: 'release is an event, scheduled and braced for',
    supplies: 'nothing yet: every change carries the full blast radius of the release it rides in',
    requires: null,
  },
  {
    stage: 2,
    name: 'feature flags',
    whatHappens: 'deploy is decoupled from release, so code can ship dark and be turned on separately',
    supplies: 'the ability to expose a change to a subset, which is what a canary needs',
    requires: 1,
  },
  {
    stage: 3,
    name: 'canary releases',
    whatHappens: 'a change reaches a small slice of traffic before it reaches everyone',
    supplies: 'measurement: it converts a release from a bet into a measurement',
    requires: 2,
  },
  {
    stage: 4,
    name: 'automated rollback',
    whatHappens: 'observability signals revert a bad change with no human in the path',
    supplies: 'the removal of personal risk, and therefore of the fear',
    requires: 3,
  },
  {
    stage: 5,
    name: 'architectural experiments',
    whatHappens: 'the same machinery tests a data store, a model, a protocol, a scaling strategy',
    supplies: 'evidence about expensive decisions rather than argument about them',
    requires: 4,
  },
  {
    stage: 6,
    name: 'continuous experimentation',
    whatHappens: 'shipping is ordinary, production writes the specification',
    supplies: 'a loop that runs continuously rather than as a project',
    requires: 5,
  },
];

export interface Capabilities {
  canShipDark: boolean;
  canMeasureOnASlice: boolean;
  canRevertWithoutAHuman: boolean;
  canTestArchitecturalChoices: boolean;
}

/**
 * What a team at each stage can actually do.
 *
 * The interesting row is stage 2: `canShipDark` is true and `canMeasureOnASlice` is false. The chapter's
 * line for it is exact: flags without a canary buy the ability to hide unfinished work and none of the
 * ability to measure it.
 */
export function capabilitiesAt(stage: Stage): Capabilities {
  return {
    canShipDark: stage >= 2,
    canMeasureOnASlice: stage >= 3,
    canRevertWithoutAHuman: stage >= 4,
    canTestArchitecturalChoices: stage >= 5,
  };
}

export type SkipVerdict =
  | { sound: true }
  | { sound: false; missing: Stage[]; appearanceOf: string; reason: string };

/**
 * Attempt to operate at `target` having reached `reached`.
 */
export function attemptStage(reached: Stage, target: Stage): SkipVerdict {
  if (target <= reached + 1) return { sound: true };

  const missing = Array.from({ length: target - reached - 1 }, (_, i) => (reached + 1 + i) as Stage);
  const spec = PROGRESSION[target - 1]!;

  return {
    sound: false,
    missing,
    appearanceOf: spec.name,
    reason:
      `stage(s) ${missing.join(', ')} were skipped. ${spec.name} without ` +
      `${missing.map((m) => PROGRESSION[m - 1]!.name).join(' and ')} produces the appearance of the ` +
      `capability without the mechanism underneath it.`,
  };
}

/**
 * Why stage two is the stalling point, expressed as the thing that is missing rather than as a virtue
 * the team lacks.
 *
 * A flag resolves because something forces it to. The canary produces the measurement that ends the
 * experiment, and automated rollback makes acting on that measurement cheap. Remove both and a flag's
 * expiry date is the only pressure left, which is a calendar entry competing with a roadmap.
 */
export function forcingFunctions(stage: Stage): { present: string[]; absent: string[] } {
  const all = [
    { name: 'a canary that produces the measurement ending the experiment', from: 3 as Stage },
    { name: 'automated rollback that makes acting on the measurement cheap', from: 4 as Stage },
  ];
  return {
    present: all.filter((f) => stage >= f.from).map((f) => f.name),
    absent: all.filter((f) => stage < f.from).map((f) => f.name),
  };
}

export const SHOPFLOW_STAGE: Stage = 2;
