/**
 * The kill switch and the post-halt lifecycle.
 *
 * Every control in runtime-governance is preventive: it stops an agent doing what it was never permitted
 * to do. The kill switch exists for the other case, which is Dave's alert: the reroute agent did
 * something its permissions allowed, the business could not accept the result, and there was no way to
 * stop it.
 *
 * The Kill-Switch Mandate has four properties, and three of them are the ones that get lost:
 *
 *   single         one mechanism, not a procedure assembled under pressure
 *   unbypassable   the agent cannot decline it
 *   in isolation   halting this agent does not halt the service it runs inside
 *   immediate      no deploy, no restart, no config rollout
 *
 * The Anti-Pattern is The Unkillable Agent: one whose only off switch is taking down the service it runs
 * inside. That is why `isolation` is modelled as a registry of independently haltable agents rather than
 * a boolean on a process.
 */

export interface AgentRegistration {
  agent: string;
  halted: boolean;
  /** Actions in flight when the halt landed. */
  inFlight: number;
}

export interface KillSwitchResult {
  halted: string;
  /** Agents still running. Halting one must not stop the others, or it is not a kill switch. */
  stillRunning: string[];
  serviceStillServing: boolean;
  inFlightAbandoned: number;
  latencyMs: number;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRegistration>();

  register(agent: string, inFlight = 0): void {
    this.agents.set(agent, { agent, halted: false, inFlight });
  }

  /**
   * Halt one agent. Deliberately synchronous and local: a kill switch that needs a deploy is not
   * immediate, and one that needs the agent's cooperation is not unbypassable.
   */
  halt(agent: string): KillSwitchResult {
    const reg = this.agents.get(agent);
    if (!reg) throw new Error(`${agent} is not registered, so it cannot be halted. An unregistered agent has no kill switch.`);

    reg.halted = true;
    return {
      halted: agent,
      stillRunning: [...this.agents.values()].filter((a) => !a.halted).map((a) => a.agent),
      serviceStillServing: true,
      inFlightAbandoned: reg.inFlight,
      latencyMs: 0,
    };
  }

  isHalted(agent: string): boolean {
    return this.agents.get(agent)?.halted ?? false;
  }

  /** The gate every action passes. A halted agent's actions do not execute, whatever the agent decides. */
  mayExecute(agent: string): boolean {
    return !this.isHalted(agent);
  }
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Post-Halt Lifecycle Rule. Six stages, in order.
 *
 * The stage that gets skipped under pressure is shadow revalidation, and the chapter is blunt about the
 * consequence: an agent restored without it is an agent whose next incident you have scheduled rather
 * than prevented. So `mayReEnable` refuses on that specifically.
 */
export const POST_HALT_STAGES = [
  'halt',
  'capture-session-context',
  'snapshot-audit-trail',
  'diagnose-root-cause',
  'fix-and-revalidate-in-shadow',
  're-enable-at-a-lower-rung',
] as const;

export type PostHaltStage = (typeof POST_HALT_STAGES)[number];

/** The three root causes, because the fix is different for each. */
export type RootCause = 'governance-defect' | 'policy-defect' | 'bad-upstream-input';

export const FIX_BY_ROOT_CAUSE: Record<RootCause, string> = {
  // The agent did something outside policy: the gate failed.
  'governance-defect': 'the enforcement gate let through what policy forbade. Fix the gate, not the policy.',
  // The agent did something inside policy that the business could not accept: the policy was wrong.
  'policy-defect': 'the action was permitted and should not have been. Narrow the policy; the gate worked.',
  // Neither: the agent behaved correctly on input it should never have received.
  'bad-upstream-input': 'the agent reasoned correctly from bad input. Fix validation upstream; widening agent logic here hides the real defect.',
};

export interface PostHaltState {
  agent: string;
  haltedAtIso: string;
  sessionContextCaptured: boolean;
  /** A rotating log is not a snapshot. Evidence has to survive the rotation. */
  auditTrailSnapshotted: boolean;
  rootCause: RootCause | null;
  fixApplied: boolean;
  shadowRevalidationDays: number;
  rungBeforeHalt: number;
}

export type ReEnableVerdict =
  | { reEnable: true; atRung: number; note: string }
  | { reEnable: false; blockedAt: PostHaltStage; reason: string };

export const SHADOW_REVALIDATION_DAYS = 14;

export function mayReEnable(s: PostHaltState): ReEnableVerdict {
  if (!s.sessionContextCaptured) {
    return {
      reEnable: false,
      blockedAt: 'capture-session-context',
      reason: 'the session context decays. Capture the inputs, tool calls and policy decisions before they are gone.',
    };
  }
  if (!s.auditTrailSnapshotted) {
    return {
      reEnable: false,
      blockedAt: 'snapshot-audit-trail',
      reason: 'the audit trail is still in a rotating log. Snapshot it as evidence; it may have a regulatory dimension.',
    };
  }
  if (s.rootCause === null) {
    return {
      reEnable: false,
      blockedAt: 'diagnose-root-cause',
      reason: 'no root cause classified. The fix differs for a governance defect, a policy defect and bad upstream input.',
    };
  }
  if (!s.fixApplied) {
    return { reEnable: false, blockedAt: 'fix-and-revalidate-in-shadow', reason: FIX_BY_ROOT_CAUSE[s.rootCause] };
  }
  if (s.shadowRevalidationDays < SHADOW_REVALIDATION_DAYS) {
    return {
      reEnable: false,
      blockedAt: 'fix-and-revalidate-in-shadow',
      reason:
        `${s.shadowRevalidationDays} of ${SHADOW_REVALIDATION_DAYS} days of shadow revalidation. An agent ` +
        `restored without it is an agent whose next incident you have scheduled rather than prevented.`,
    };
  }

  const atRung = Math.max(2, s.rungBeforeHalt - 1);
  return {
    reEnable: true,
    atRung,
    note: `returns at rung ${atRung}, below the ${s.rungBeforeHalt} it held, and earns the rest back on the evidence the ladder always required.`,
  };
}

/**
 * A halt is the start of an incident, not the end of one. The switch buys time; it diagnoses nothing.
 */
export function stagesRemaining(s: PostHaltState): PostHaltStage[] {
  const done = new Set<PostHaltStage>(['halt']);
  if (s.sessionContextCaptured) done.add('capture-session-context');
  if (s.auditTrailSnapshotted) done.add('snapshot-audit-trail');
  if (s.rootCause !== null) done.add('diagnose-root-cause');
  if (s.fixApplied && s.shadowRevalidationDays >= SHADOW_REVALIDATION_DAYS) done.add('fix-and-revalidate-in-shadow');
  return POST_HALT_STAGES.filter((st) => !done.has(st));
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Overnight-Discovery Rule, which is the one operational claim in this chapter that is not about
 * agents behaving badly.
 *
 * AI traffic to a tool or MCP endpoint does not ramp along a forecastable human curve. The consumers are
 * agents, and when they discover the endpoint is useful, volume can multiply overnight. You provision for
 * a step change rather than a trend, because the step change is the normal case.
 *
 * The ShopFlow figures make a point worth keeping: the capacity was cheap and the governance gap was not.
 */
export interface EndpointReadiness {
  currentCallsPerDay: number;
  /** The step change to plan for, not the trend to extrapolate. */
  plausibleStepMultiple: number;
  autoscalingCeilingCallsPerDay: number;
  extraCostAtStepUsdPerMonth: number;
  /** Are the calls attributable to a consumer and gated by policy? */
  callsGoverned: boolean;
}

export interface ReadinessFinding {
  callsAtStep: number;
  capacityAbsorbs: boolean;
  capacityCostUsdPerMonth: number;
  ungovernedCallsAtStep: number;
  verdict: 'ready' | 'capacity-gap' | 'governance-gap' | 'both';
  note: string;
}

export function assessEndpoint(e: EndpointReadiness): ReadinessFinding {
  const callsAtStep = e.currentCallsPerDay * e.plausibleStepMultiple;
  const capacityAbsorbs = callsAtStep <= e.autoscalingCeilingCallsPerDay;
  const ungovernedCallsAtStep = e.callsGoverned ? 0 : callsAtStep;

  const verdict = capacityAbsorbs
    ? e.callsGoverned
      ? 'ready'
      : 'governance-gap'
    : e.callsGoverned
      ? 'capacity-gap'
      : 'both';

  return {
    callsAtStep,
    capacityAbsorbs,
    capacityCostUsdPerMonth: e.extraCostAtStepUsdPerMonth,
    ungovernedCallsAtStep,
    verdict,
    note:
      verdict === 'governance-gap'
        ? `the capacity is cheap insurance at $${e.extraCostAtStepUsdPerMonth}/month. ` +
          `${callsAtStep.toLocaleString()} ungoverned, unattributable tool calls a day is an exposure no budget covers.`
        : verdict === 'ready'
          ? 'sized and governed for the step change'
          : 'the endpoint is one integration away from being overwhelmed',
  };
}

export const SHOPFLOW_MCP: EndpointReadiness = {
  currentCallsPerDay: 12_000,
  plausibleStepMultiple: 10, // comparable services stepped to 120,000/day within 48 hours
  autoscalingCeilingCallsPerDay: 150_000,
  extraCostAtStepUsdPerMonth: 300,
  callsGoverned: false,
};
