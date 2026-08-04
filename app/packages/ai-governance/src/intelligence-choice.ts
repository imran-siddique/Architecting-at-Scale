/**
 * The five gates, in order, and why the order is the whole argument.
 *
 * ShopFlow enters Chapter 15 with nine AI features, roughly 40% of them deterministic problems running
 * on a model, three agents able to take real actions with no hard stop, and zero of the ten OWASP
 * Agentic risks covered.
 *
 * The Gate-Order Rule: ask the five questions in order and stop at the first gate that resolves the
 * problem. The order is not a preference. Each gate is cheaper, faster and more predictable than the
 * one after it, so any question answered early saves everything downstream of it.
 *
 * The consequence the chapter draws is the one this module is built to make testable: a team that
 * starts at gate four is governing a model whose presence was never justified, and no amount of
 * governance makes an unnecessary model call a good decision.
 */

export type Gate = 1 | 2 | 3 | 4 | 5;

export interface Problem {
  name: string;
  /** Are the inputs bounded? Open user language is not. */
  inputsBounded: boolean;
  /** Can the set of valid outputs be enumerated in advance? */
  outputsEnumerable: boolean;
  /** Structured features plus labeled history, i.e. a prediction or a score. */
  structuredPredictionOverLabeledHistory: boolean;
  takesAutonomousActions: boolean;
  actionsMateriallyImpactBusiness: boolean;
}

export type Tool = 'rules-or-state-machine' | 'traditional-ml' | 'large-language-model';

export interface Resolution {
  problem: string;
  /** The first gate that resolved it. */
  resolvedAtGate: Gate;
  tool: Tool;
  /** Obligations that ship WITH the feature, not after it. */
  requires: ('runtime-governance' | 'kill-switch' | 'human-approval-on-high-impact')[];
  reason: string;
}

/**
 * Walk the gates. Gates 1 to 3 decide whether you have an AI problem at all; gates 4 and 5 decide what
 * you owe the business if you do.
 */
export function chooseIntelligence(p: Problem): Resolution {
  // Gate 1. Bounded inputs with enumerable outputs never need a model.
  if (p.inputsBounded && p.outputsEnumerable) {
    return {
      problem: p.name,
      resolvedAtGate: 1,
      tool: 'rules-or-state-machine',
      requires: [],
      reason:
        'bounded inputs and enumerable outputs. A model adds nothing to a problem whose answers you can ' +
        'already enumerate, and it adds the risk of returning an answer outside the set you defined.',
    };
  }

  // Gate 2. Structured prediction belongs to traditional ML before it belongs to an LLM.
  if (p.structuredPredictionOverLabeledHistory) {
    return {
      problem: p.name,
      resolvedAtGate: 2,
      tool: 'traditional-ml',
      requires: [],
      reason: 'structured features over labeled history. Moderate cost, predictable, and it needs training data rather than a prompt.',
    };
  }

  // Gate 3. Only here does an LLM earn its cost and its nondeterminism.
  const requires: Resolution['requires'] = [];
  if (p.takesAutonomousActions) requires.push('runtime-governance');
  if (p.actionsMateriallyImpactBusiness) requires.push('kill-switch', 'human-approval-on-high-impact');

  return {
    problem: p.name,
    resolvedAtGate: p.actionsMateriallyImpactBusiness ? 5 : p.takesAutonomousActions ? 4 : 3,
    tool: 'large-language-model',
    requires,
    reason:
      'genuinely unbounded: open language in, an output that cannot be enumerated out. ' +
      (requires.length > 0
        ? 'The obligations below are conditions of shipping, not follow-up work.'
        : 'No autonomous actions, so no governance obligations beyond the usual.'),
  };
}

/**
 * What happens when a team enters at gate four.
 *
 * This is not a hypothetical. It is how a deterministic problem ends up with a policy engine, an audit
 * trail and a kill switch wrapped around a model call that should never have existed. The governance is
 * all correct. The architecture is still wrong, and the governance is what makes it look reviewed.
 */
export interface SkippedGateFinding {
  problem: string;
  enteredAtGate: Gate;
  wouldHaveResolvedAtGate: Gate;
  governanceIsCorrect: boolean;
  architectureIsCorrect: boolean;
  note: string;
}

export function auditGateOrder(p: Problem, enteredAtGate: Gate): SkippedGateFinding {
  const proper = chooseIntelligence(p);
  const skipped = enteredAtGate > proper.resolvedAtGate;

  return {
    problem: p.name,
    enteredAtGate,
    wouldHaveResolvedAtGate: proper.resolvedAtGate,
    governanceIsCorrect: enteredAtGate >= 4,
    architectureIsCorrect: !skipped,
    note: skipped
      ? `entered at gate ${enteredAtGate}, would have resolved at gate ${proper.resolvedAtGate}. ` +
        `This is a model whose presence was never justified, and no amount of governance makes an ` +
        `unnecessary model call a good decision. Correct governance on the wrong architecture is worse ` +
        `than none, because it makes the feature look reviewed.`
      : `entered at the gate that resolves it`,
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The form validator, where the model was strictly worse on every axis.
 *
 * The point of modelling this rather than just asserting it: on a bounded-input, known-output problem
 * the deterministic path is not a trade-off against quality. It wins on cost, on latency AND on
 * correctness simultaneously, which almost never happens and is exactly what the Bounded-Input Rule
 * predicts.
 */
export interface Implementation {
  approach: 'model' | 'deterministic-rule';
  usdPerCheck: number;
  addedLatencyMs: number;
  /** Fraction of checks that return an answer outside the defined output set. */
  outOfFormatRate: number;
}

export const ADDRESS_VALIDATOR: Record<'before' | 'after', Implementation> = {
  before: { approach: 'model', usdPerCheck: 0.0008, addedLatencyMs: 420, outOfFormatRate: 0.004 },
  after: { approach: 'deterministic-rule', usdPerCheck: 0, addedLatencyMs: 2, outOfFormatRate: 0 },
};

export interface AxisComparison {
  cheaper: 'model' | 'deterministic-rule';
  faster: 'model' | 'deterministic-rule';
  moreCorrect: 'model' | 'deterministic-rule';
  strictlyWorse: 'model' | 'deterministic-rule' | null;
}

export function compareOnEveryAxis(a: Implementation, b: Implementation): AxisComparison {
  const cheaper = a.usdPerCheck <= b.usdPerCheck ? a.approach : b.approach;
  const faster = a.addedLatencyMs <= b.addedLatencyMs ? a.approach : b.approach;
  const moreCorrect = a.outOfFormatRate <= b.outOfFormatRate ? a.approach : b.approach;

  const winners = new Set([cheaper, faster, moreCorrect]);
  const strictlyWorse =
    winners.size === 1 ? (winners.has(a.approach) ? b.approach : a.approach) : null;

  return { cheaper, faster, moreCorrect, strictlyWorse };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Narrow-Model Rule. The model gets the single step whose input is unbounded and whose output
 * cannot be enumerated; deterministic code keeps everything around it.
 *
 * The rule's warning is about drift: left alone, the boundary moves outward one convenience at a time.
 * So this validates a workflow's assignment rather than trusting the design review to have held.
 */
export type StepKind =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'routing'
  | 'action-execution'
  | 'open-language-interpretation'
  | 'unspecifiable-generation';

/** Steps that have exactly one correct answer, so a model can only import nondeterminism. */
export const DETERMINISTIC_STEPS: readonly StepKind[] = [
  'authentication',
  'authorization',
  'validation',
  'routing',
  'action-execution',
];

export interface WorkflowStep {
  name: string;
  kind: StepKind;
  handledBy: 'model' | 'code';
}

export interface BoundaryViolation {
  step: string;
  kind: StepKind;
  note: string;
}

export function checkModelBoundary(steps: WorkflowStep[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  for (const s of steps) {
    if (s.handledBy === 'model' && DETERMINISTIC_STEPS.includes(s.kind)) {
      violations.push({
        step: s.name,
        kind: s.kind,
        note: `${s.kind} has exactly one correct answer. Widening the model's slice to cover it buys nothing and imports nondeterminism.`,
      });
    }
    if (s.handledBy === 'code' && !DETERMINISTIC_STEPS.includes(s.kind)) {
      violations.push({
        step: s.name,
        kind: s.kind,
        note: `${s.kind} is the unbounded step. Code cannot enumerate its output, which is what a model is for.`,
      });
    }
  }

  return violations;
}
