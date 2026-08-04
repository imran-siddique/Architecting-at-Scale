/**
 * Governing the AI bill: the chokepoint, the cascade, and cost per outcome.
 *
 * The chapter's most transferable claim is that token cost is decided at runtime by the model and the
 * agent's behaviour rather than at provisioning time, so it cannot be governed by sizing decisions made
 * in advance. Everything here follows from that.
 *
 * The Single-Chokepoint Rule: every model call passes through one guarded path, and no raw call exists
 * outside it. A single bypass leaks the entire budget through that gap, which is why this module makes
 * the bypass a structural fact you can test for rather than a review-time observation.
 */

export type ModelTier = 'cheap' | 'mid' | 'capable';

export interface ModelPricing {
  tier: ModelTier;
  usdPerCall: number;
}

export const PRICING: Record<ModelTier, number> = { cheap: 0.002, mid: 0.012, capable: 0.06 };

export interface CallSite {
  file: string;
  /** True when the call goes through the guarded client. */
  viaChokepoint: boolean;
}

export interface ChokepointAudit {
  totalCallSites: number;
  bypasses: string[];
  /** The budget is only enforceable if there are zero bypasses. */
  budgetEnforceable: boolean;
  note: string;
}

export function auditChokepoint(sites: CallSite[]): ChokepointAudit {
  const bypasses = sites.filter((s) => !s.viaChokepoint).map((s) => s.file);
  return {
    totalCallSites: sites.length,
    bypasses,
    budgetEnforceable: bypasses.length === 0,
    note:
      bypasses.length === 0
        ? 'one guarded path. Cost governance is structural rather than a matter of operating carefully.'
        : `${bypasses.length} bypass(es). A single one leaks the entire budget through that gap, so ` +
          `${(100).toFixed(0)}% of the guard's value is contingent on closing them. Verify this before ` +
          `verifying anything else about AI code.`,
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The guarded client. Three enforcement points, because each one bounds a different failure.
 *
 *   the cascade      bounds the cost of a TYPICAL request
 *   the step cap     bounds a reasoning loop that would otherwise not terminate
 *   the budget       bounds the WORST case, which is the one that produces the $500/hour story
 *
 * A cascade alone does not save you from a loop, and a step cap alone does not save you from fifty
 * cheap calls that were each within the cap.
 */
export interface GuardConfig {
  cascade: ModelTier[];
  maxStepsPerTask: number;
  budgetPerConversationUsd: number;
}

export interface Attempt {
  tier: ModelTier;
  accepted: boolean;
}

export interface ConversationRequest {
  id: string;
  /** Per step, the tier at which this request first produces an acceptable answer. */
  succeedsAtTier: ModelTier | null;
  stepsRequested: number;
}

export interface ConversationResult {
  id: string;
  attempts: Attempt[];
  resolved: boolean;
  costUsd: number;
  stoppedBy: 'resolved' | 'step-cap' | 'budget' | 'cascade-exhausted';
}

export function runConversation(req: ConversationRequest, cfg: GuardConfig): ConversationResult {
  const attempts: Attempt[] = [];
  let costUsd = 0;
  let steps = 0;

  for (let step = 0; step < req.stepsRequested; step++) {
    if (steps >= cfg.maxStepsPerTask) {
      return { id: req.id, attempts, resolved: false, costUsd, stoppedBy: 'step-cap' };
    }

    for (const tier of cfg.cascade) {
      const price = PRICING[tier];
      if (costUsd + price > cfg.budgetPerConversationUsd) {
        return { id: req.id, attempts, resolved: false, costUsd, stoppedBy: 'budget' };
      }
      costUsd += price;
      const accepted = req.succeedsAtTier !== null && cascadeRank(tier) >= cascadeRank(req.succeedsAtTier);
      attempts.push({ tier, accepted });
      if (accepted) {
        return { id: req.id, attempts, resolved: true, costUsd, stoppedBy: 'resolved' };
      }
    }
    steps++;
  }

  return { id: req.id, attempts, resolved: false, costUsd, stoppedBy: 'cascade-exhausted' };
}

function cascadeRank(t: ModelTier): number {
  return { cheap: 0, mid: 1, capable: 2 }[t];
}

/**
 * The ungoverned version, for contrast. Every conversation on the most capable model, no step cap.
 * This is the shape that cost about $500 an hour at peak on a real platform.
 */
export function runUngoverned(req: ConversationRequest): ConversationResult {
  const attempts: Attempt[] = [];
  let costUsd = 0;
  for (let step = 0; step < req.stepsRequested; step++) {
    costUsd += PRICING.capable;
    const accepted = req.succeedsAtTier !== null;
    attempts.push({ tier: 'capable', accepted });
    if (accepted) return { id: req.id, attempts, resolved: true, costUsd, stoppedBy: 'resolved' };
  }
  return { id: req.id, attempts, resolved: false, costUsd, stoppedBy: 'cascade-exhausted' };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Cost-Per-Outcome-Not-Per-Call Rule.
 *
 * A cheap model called fifty times in a loop costs more than an expensive model called once. The
 * per-call price is what vendors quote; the per-outcome cost is what lands on the bill. And the
 * denominator has to be RESOLVED conversations, not all of them, or the metric improves when the agent
 * gives up faster.
 */
export interface OutcomeCost {
  totalUsd: number;
  conversations: number;
  resolved: number;
  costPerConversationUsd: number;
  costPerResolvedUsd: number;
  resolutionRate: number;
}

export function outcomeCost(results: ConversationResult[]): OutcomeCost {
  const totalUsd = results.reduce((a, r) => a + r.costUsd, 0);
  const resolved = results.filter((r) => r.resolved).length;
  return {
    totalUsd,
    conversations: results.length,
    resolved,
    costPerConversationUsd: totalUsd / results.length,
    costPerResolvedUsd: resolved === 0 ? Number.POSITIVE_INFINITY : totalUsd / resolved,
    resolutionRate: resolved / results.length,
  };
}

/**
 * The Cascade Recalibration Rule: validate on all five signals, because optimizing any of the first
 * four alone moves cost off the bill and onto the customer.
 */
export const CASCADE_SIGNALS = [
  'escalation-rate',
  'answer-quality',
  'latency',
  'tokens-per-outcome',
  'resolution-rate',
] as const;

export interface CascadeEvaluation {
  monthsSinceRecalibration: number;
  vendorChangedTiers: boolean;
  signalsMeasured: readonly string[];
}

export type CascadeVerdict = { valid: true } | { valid: false; reason: string; missingSignals?: string[] };

export function evaluateCascade(e: CascadeEvaluation): CascadeVerdict {
  const missingSignals = CASCADE_SIGNALS.filter((s) => !e.signalsMeasured.includes(s));
  if (missingSignals.length > 0) {
    return {
      valid: false,
      reason:
        'validated on a subset of the signals. Optimizing escalation rate, quality, latency or tokens ' +
        'alone moves cost off the bill and onto the customer.',
      missingSignals: [...missingSignals],
    };
  }
  if (e.vendorChangedTiers) {
    return { valid: false, reason: 'a vendor shipped, deprecated or repriced a tier, which invalidates the thresholds immediately' };
  }
  if (e.monthsSinceRecalibration >= 3) {
    return { valid: false, reason: `${e.monthsSinceRecalibration} months since recalibration. A cascade is a tuned parameter, not a configuration you set once.` };
  }
  return { valid: true };
}

/**
 * Retire any feature whose cost per outcome exceeds the value of the outcome. Note the asymmetry: this
 * is the one place the chapter says to remove an AI feature rather than govern it, and it needs the
 * value of the outcome supplied from outside.
 */
export function retirementCheck(input: {
  feature: string;
  costPerOutcomeUsd: number;
  valuePerOutcomeUsd: number;
}): { retire: boolean; marginUsd: number; reason: string } {
  const marginUsd = input.valuePerOutcomeUsd - input.costPerOutcomeUsd;
  return {
    retire: marginUsd < 0,
    marginUsd,
    reason:
      marginUsd < 0
        ? `each outcome costs $${input.costPerOutcomeUsd.toFixed(2)} and is worth $${input.valuePerOutcomeUsd.toFixed(2)}. Governing the cost does not fix a negative margin.`
        : `margin of $${marginUsd.toFixed(2)} per outcome. This is a governance problem, not a retirement one.`,
  };
}
