/**
 * The agent autonomy ladder: five rungs, climbed on evidence from production traffic.
 *
 * Two things about this ladder are easy to miss, and both are encoded here rather than described.
 *
 * Rung five does not mean full autonomy. High-impact, hard-to-reverse actions never leave rung three,
 * permanently, so `mayActAutonomously` takes the ACTION into account and not only the rung.
 *
 * Rung two is the one that gets skipped and the one that earns its keep. Shadow mode is the only rung
 * where an agent meets real production input, hostile and malformed and ambiguous, before reality can
 * be affected by it. Skipping it means the first hostile input arrives in production with the agent's
 * decisions live.
 */

export type Rung = 1 | 2 | 3 | 4 | 5;

export interface RungSpec {
  rung: Rung;
  name: string;
  whatHappens: string;
  whatItProves: string;
  criterionToAdvance: string;
  minimumObservationDays: number;
}

export const LADDER: readonly RungSpec[] = [
  {
    rung: 1,
    name: 'proof of concept',
    whatHappens: 'runs against sample inputs outside production',
    whatItProves: 'the capability exists',
    criterionToAdvance: 'it works at all. Nothing about production is established',
    minimumObservationDays: 0,
  },
  {
    rung: 2,
    name: 'shadow mode',
    whatHappens: 'runs on real production traffic; decisions are logged, never executed',
    whatItProves: 'it behaves sensibly on hostile, ambiguous, real input',
    criterionToAdvance: 'agreement with the existing path across a full traffic cycle',
    minimumObservationDays: 14,
  },
  {
    rung: 3,
    name: 'human approval',
    whatHappens: 'decisions execute, but only after a person approves each one',
    whatItProves: 'its decisions are good enough that approval becomes routine',
    criterionToAdvance: 'a high approval rate where reviewers are demonstrably reading',
    minimumObservationDays: 30,
  },
  {
    rung: 4,
    name: 'limited autonomous actions',
    whatHappens: 'acts without approval inside a scoped, low-impact, reversible boundary',
    whatItProves: 'it acts correctly with nothing between its decision and the action',
    criterionToAdvance: 'a clean observation period at scope, with no policy violations',
    minimumObservationDays: 60,
  },
  {
    rung: 5,
    name: 'fully governed production agent',
    whatHappens: 'broader autonomy under least agency, runtime policy and an audit trail',
    whatItProves: 'it can be trusted within a boundary that is enforced rather than assumed',
    criterionToAdvance: 'steady state. High-impact actions remain permanently on rung three',
    minimumObservationDays: 0,
  },
];

export interface AgentState {
  agent: string;
  currentRung: Rung;
  daysAtCurrentRung: number;
  criterionMet: boolean;
  /** Evidence source. A demo is not production traffic. */
  evidenceFrom: 'production-traffic' | 'demo' | 'a-date-on-the-roadmap';
  behavioralDriftDetected: boolean;
  inputDistributionChanged: boolean;
  replayTestFailed: boolean;
}

export type LadderMove =
  | { move: 'promote'; to: Rung }
  | { move: 'hold'; reason: string }
  | { move: 'demote'; to: Rung; reason: string };

/**
 * The ladder is bidirectional, and demotion is routine rather than exceptional. Checking demotion
 * FIRST is deliberate: an agent that has drifted should not be promoted on a criterion it met before
 * the drift.
 */
export function nextMove(s: AgentState): LadderMove {
  const demotionCause = s.behavioralDriftDetected
    ? 'behavioral drift'
    : s.inputDistributionChanged
      ? 'the input distribution changed'
      : s.replayTestFailed
        ? 'a replay test failed'
        : null;

  if (demotionCause !== null) {
    const to = Math.max(1, s.currentRung - 1) as Rung;
    return {
      move: 'demote',
      to,
      reason: `${demotionCause}. Demotion is routine rather than exceptional, and the criterion this agent met was met before the change.`,
    };
  }

  if (s.evidenceFrom !== 'production-traffic') {
    return {
      move: 'hold',
      reason: `evidence is from ${s.evidenceFrom}. An agent climbs on evidence from production traffic, never on a demo and never on a date.`,
    };
  }

  const spec = LADDER[s.currentRung - 1]!;
  if (!s.criterionMet) return { move: 'hold', reason: `the criterion for rung ${s.currentRung} is not met: ${spec.criterionToAdvance}` };
  if (s.daysAtCurrentRung < spec.minimumObservationDays) {
    return {
      move: 'hold',
      reason: `${s.daysAtCurrentRung} of ${spec.minimumObservationDays} observation days at rung ${s.currentRung}. Both the criterion AND the period are required.`,
    };
  }
  if (s.currentRung === 5) return { move: 'hold', reason: 'rung 5 is steady state' };

  return { move: 'promote', to: (s.currentRung + 1) as Rung };
}

/**
 * Skipping shadow mode skips the only rung that tests the agent against reality before reality can be
 * affected by it.
 */
export function validatePromotionPath(path: Rung[]): { valid: boolean; reason?: string } {
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    if (to > from + 1) {
      const skipped = Array.from({ length: to - from - 1 }, (_, k) => from + 1 + k);
      if (skipped.includes(2)) {
        return {
          valid: false,
          reason:
            'shadow mode was skipped. It is the only rung where the agent meets hostile, malformed, ' +
            'ambiguous real input before reality can be affected by it.',
        };
      }
      return { valid: false, reason: `rung(s) ${skipped.join(', ')} were skipped` };
    }
  }
  return { valid: true };
}

/* ------------------------------------------------------------------------------------------- */

export interface Action {
  name: string;
  reversible: boolean;
  /** Number of entities a single invocation can affect. */
  blastRadius: number;
  materialBusinessImpact: boolean;
}

export const HIGH_IMPACT_BLAST_RADIUS = 50;

export function isHighImpact(a: Action): boolean {
  return !a.reversible || a.blastRadius >= HIGH_IMPACT_BLAST_RADIUS || a.materialBusinessImpact;
}

/**
 * Rung five is not full autonomy.
 *
 * The Human-in-the-Loop Rule draws the line at reversibility and blast radius, not at convenience, so
 * a fully governed rung-five agent still cannot execute a high-impact action without approval.
 */
export function mayActAutonomously(rung: Rung, action: Action): { autonomous: boolean; reason: string } {
  if (isHighImpact(action)) {
    return {
      autonomous: false,
      reason:
        `${action.name} is high-impact (${!action.reversible ? 'irreversible' : `blast radius ${action.blastRadius}`}). ` +
        `High-impact, hard-to-reverse actions remain permanently on rung three, so even a rung-5 agent ` +
        `prepares and a human authorizes. The line is reversibility and blast radius, not convenience.`,
    };
  }
  if (rung < 4) {
    return { autonomous: false, reason: `rung ${rung} does not act without approval` };
  }
  return { autonomous: true, reason: 'reversible, low-impact, inside a scoped boundary' };
}

/** ShopFlow's three action-taking agents, from the telemetry snapshot. */
export const SHOPFLOW_ACTIONS: Action[] = [
  { name: 'issue-refund', reversible: false, blastRadius: 1, materialBusinessImpact: true },
  { name: 'reroute-shipment', reversible: true, blastRadius: 4_000, materialBusinessImpact: true },
  { name: 'resolve-ticket', reversible: true, blastRadius: 1, materialBusinessImpact: false },
];
