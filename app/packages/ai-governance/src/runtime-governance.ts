/**
 * Runtime enforcement, least agency, and the ten OWASP Agentic risks.
 *
 * The Runtime-Enforcement Rule: governance is enforced at runtime, between the decision and the action,
 * not requested in the prompt. A prompt instruction is a suggestion the model can ignore, misread, or be
 * manipulated past. A runtime policy engine is a deterministic gate the action cannot bypass.
 *
 *   If a control can be defeated by a cleverly worded input, it was never a control. It was a hope.
 *
 * That line is the reason this module implements BOTH kinds of guard: the point is not that the runtime
 * gate is better in principle, it is that the two behave differently on the same adversarial input and
 * you can watch it happen.
 */

export interface ProposedAction {
  agent: string;
  tool: string;
  /** Entities this invocation would affect. */
  affectedEntities: number;
  /** Free text the model produced or was given. Adversarial content lives here. */
  rationale: string;
}

/**
 * The prompt-only guardrail. Instructions live in the system prompt, so the check is whether the model
 * chose to comply, which is a property of the input rather than of the system.
 */
export function promptOnlyGuardrail(
  action: ProposedAction,
  systemPrompt: string,
): { allowed: boolean; why: string } {
  // The model was told to keep reroutes under 100 shipments. Whether it does depends on what it read.
  const instructed = /under (\d+)/.exec(systemPrompt);
  const limit = instructed ? Number(instructed[1]) : Number.POSITIVE_INFINITY;

  // This is the entire failure mode: text in the request can talk the model out of its instruction.
  const overridden = /ignore (the )?(previous|prior|above)|disregard|new instructions|you are now/i.test(
    action.rationale,
  );
  if (overridden) {
    return { allowed: true, why: 'the input instructed the model to disregard its guidance, and it did' };
  }
  return action.affectedEntities <= limit
    ? { allowed: true, why: 'within the instructed limit' }
    : { allowed: false, why: 'the model declined, as instructed' };
}

/* ------------------------------------------------------------------------------------------- */

/** Least agency: an agent gets the narrowest tool scope that does its job. */
export interface AgentPolicy {
  agent: string;
  permittedTools: string[];
  maxEntitiesPerAction: number;
  /** Tool chains must be declared. An undeclared chain is a chain nobody reviewed. */
  permittedToolChains: string[][];
  requiresApprovalAbove: number;
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'require-approval'; reason: string }
  | { decision: 'deny'; reason: string; risk: OwaspAgenticRisk };

/**
 * The runtime gate. Note what it does NOT read: `action.rationale`. The decision is a function of the
 * policy and the action's shape, so no wording of the input changes the outcome.
 */
export function enforce(action: ProposedAction, policy: AgentPolicy): PolicyDecision {
  if (!policy.permittedTools.includes(action.tool)) {
    return {
      decision: 'deny',
      reason: `${action.tool} is not in ${policy.agent}'s permitted tools`,
      risk: 'ASI02',
    };
  }
  if (action.affectedEntities > policy.maxEntitiesPerAction) {
    return {
      decision: 'deny',
      reason: `${action.affectedEntities} entities exceeds the ${policy.maxEntitiesPerAction} bound. Least agency is a bound, not a guideline.`,
      risk: 'ASI03',
    };
  }
  if (action.affectedEntities > policy.requiresApprovalAbove) {
    return {
      decision: 'require-approval',
      reason: `${action.affectedEntities} entities is above the ${policy.requiresApprovalAbove} autonomous threshold`,
    };
  }
  return { decision: 'allow' };
}

/** A tool chain the policy never declared is a path nobody reviewed. */
export function enforceChain(chain: string[], policy: AgentPolicy): PolicyDecision {
  const declared = policy.permittedToolChains.some(
    (c) => c.length === chain.length && c.every((t, i) => t === chain[i]),
  );
  if (!declared) {
    return {
      decision: 'deny',
      reason: `the chain ${chain.join(' -> ')} is not declared in policy. Each tool is permitted individually; the composition was never reviewed.`,
      risk: 'ASI02',
    };
  }
  return { decision: 'allow' };
}

export const REROUTE_AGENT_POLICY: AgentPolicy = {
  agent: 'reroute-agent',
  permittedTools: ['reroute-shipment', 'read-hub-capacity'],
  maxEntitiesPerAction: 100,
  permittedToolChains: [['read-hub-capacity', 'reroute-shipment']],
  requiresApprovalAbove: 25,
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The audit trail. Its job is not logging; it is answering "why" after the fact, which is precisely what
 * the reroute incident could not answer.
 */
export interface AuditEntry {
  agent: string;
  tool: string;
  affectedEntities: number;
  decision: PolicyDecision['decision'];
  /** The policy version that made the decision. Without it the trail cannot be reconstructed. */
  policyVersion: string;
  /** The inputs that led here, so the decision is explicable rather than merely recorded. */
  inputDigest: string;
  approvedBy: string | null;
  timestampIso: string;
}

export function isExplicable(e: AuditEntry): boolean {
  return e.policyVersion !== '' && e.inputDigest !== '';
}

/**
 * The Policy-Change Review Rule: a change to an agent's permissions travels the same path as a change to
 * application code. Version control, review, and a record of who widened what and why.
 */
export interface PolicyChange {
  agent: string;
  field: keyof AgentPolicy;
  before: unknown;
  after: unknown;
  versionControlled: boolean;
  reviewedBy: string | null;
  justification: string;
}

export type ChangeVerdict = { accept: true } | { accept: false; reason: string };

export function reviewPolicyChange(c: PolicyChange): ChangeVerdict {
  if (!c.versionControlled) return { accept: false, reason: 'not version controlled: a permission change with no diff is a permission change nobody can audit' };
  if (c.reviewedBy === null) return { accept: false, reason: 'not reviewed. Permissions travel the same path as application code' };
  if (c.justification.trim() === '') return { accept: false, reason: 'no justification recorded for widening the agent scope' };
  return { accept: true };
}

/* ------------------------------------------------------------------------------------------- */

export type OwaspAgenticRisk =
  | 'ASI01'
  | 'ASI02'
  | 'ASI03'
  | 'ASI04'
  | 'ASI05'
  | 'ASI06'
  | 'ASI07'
  | 'ASI08'
  | 'ASI09'
  | 'ASI10';

export interface RiskControl {
  risk: OwaspAgenticRisk;
  title: string;
  failure: string;
  runtimeControl: string;
}

export const OWASP_AGENTIC: readonly RiskControl[] = [
  {
    risk: 'ASI01',
    title: 'Agent Goal Hijack',
    failure: "adversarial input overrides the agent's intended objective",
    runtimeControl: 'gate actions against fixed policy, not against the prompt',
  },
  {
    risk: 'ASI02',
    title: 'Tool Misuse and Exploitation',
    failure: 'approved tools invoked in unintended or dangerous ways',
    runtimeControl: 'scope tools per task; mediate every call and gate tool chains',
  },
  {
    risk: 'ASI03',
    title: 'Identity and Privilege Abuse',
    failure: 'the agent acquires privileges beyond its role',
    runtimeControl: 'scoped, short-lived agent identities; least agency by default',
  },
  {
    risk: 'ASI04',
    title: 'Agentic Supply Chain Vulnerabilities',
    failure: 'a compromised plugin or sub-agent injects behaviour you never wrote',
    runtimeControl: 'pin permitted tool and sub-agent identities in policy; verify before use',
  },
  {
    risk: 'ASI05',
    title: 'Unexpected Code Execution',
    failure: 'an agent-driven path reaches arbitrary code execution',
    runtimeControl: 'never evaluate model output as code; sandbox anything generated',
  },
  {
    risk: 'ASI06',
    title: 'Memory and Context Poisoning',
    failure: 'a persistent memory store is manipulated to corrupt later decisions',
    runtimeControl: 'validate and isolate memory; audit every context write',
  },
  {
    risk: 'ASI07',
    title: 'Insecure Inter-Agent Communication',
    failure: 'messages between agents carry no authentication or integrity',
    runtimeControl: 'verify agent identity on every handoff; sign and integrity-check messages',
  },
  {
    risk: 'ASI08',
    title: 'Cascading Agent Failures',
    failure: "one agent's failure propagates through the system",
    runtimeControl: 'circuit breakers and blast-radius caps between agents; rate-limit handoffs',
  },
  {
    risk: 'ASI09',
    title: 'Human-Agent Trust Exploitation',
    failure: 'humans over-trust the agent output and stop validating it',
    runtimeControl: 'tamper-evident audit trail plus an approval gate that shows the reasoning',
  },
  {
    risk: 'ASI10',
    title: 'Rogue Agents',
    failure: 'behaviour drifts off-task with no attacker involved',
    runtimeControl: 'behavioural baselines, anomaly detection, and a scoped kill switch',
  },
];

export interface CoverageReport {
  covered: OwaspAgenticRisk[];
  uncovered: OwaspAgenticRisk[];
  fraction: number;
}

export function riskCoverage(controlsImplemented: OwaspAgenticRisk[]): CoverageReport {
  const covered = OWASP_AGENTIC.filter((r) => controlsImplemented.includes(r.risk)).map((r) => r.risk);
  const uncovered = OWASP_AGENTIC.filter((r) => !controlsImplemented.includes(r.risk)).map((r) => r.risk);
  return { covered, uncovered, fraction: covered.length / OWASP_AGENTIC.length };
}
