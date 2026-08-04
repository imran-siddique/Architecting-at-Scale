/**
 * Feature flags, and the graveyard.
 *
 * Dave's alert: 180-some flags, half of them unidentifiable, so every change touches a path some old flag
 * might still be gating and nobody wants to be the one who breaks it.
 *
 * The Flag-Is-Not-Config Rule is the root of it. A flag is a temporary instrument for running an
 * experiment; a configuration is a permanent, intentional choice. They differ in lifetime and in purpose,
 * and treating a flag as a long-lived configuration is what produces the graveyard, because a flag with
 * no end is a flag that never gets removed.
 */

export interface Flag {
  key: string;
  hypothesis: string;
  /** Mandatory. An experiment with no end date was never an experiment. */
  expiryIso: string | null;
  /** Attaches to the SERVICE, not the individual, so it transfers when the service does. */
  ownerService: string | null;
  rolloutPercent: number;
  /** Paths in the codebase this flag gates. Used for the reasoning-tax model. */
  gatedPaths: string[];
  createdIso: string;
}

/** A configuration, for contrast. Different in lifetime and in purpose. */
export interface Configuration {
  key: string;
  purpose: string;
  /** No expiry, by design. It is the setting. */
  permanent: true;
}

export const FLAG_VS_CONFIG = [
  { property: 'purpose', flag: 'run an experiment; gate a new behaviour', config: 'express a permanent, intentional choice' },
  { property: 'lifetime', flag: 'temporary; ends when the experiment resolves', config: 'long-lived by design' },
  { property: 'end-state', flag: 'removed: behaviour made permanent or dropped', config: 'stays; it is the setting' },
  { property: "owner's intent", flag: 'I am trying this out', config: 'this is how it is meant to be used' },
] as const;

export type CreationVerdict = { accept: true } | { accept: false; reason: string };

/**
 * Refuse to create a flag that cannot be resolved. Both fields are the ones that decide whether the flag
 * will ever be removed, and both are cheap at creation and impossible to recover later.
 */
export function createFlag(f: Flag): CreationVerdict {
  if (f.expiryIso === null) {
    return {
      accept: false,
      reason: 'no expiry date. An experiment with no end date was never an experiment; it was a permanent fork introduced by accident.',
    };
  }
  if (f.ownerService === null) {
    return {
      accept: false,
      reason:
        'no owning service. An unowned flag is an unremovable flag, because deleting it requires knowing ' +
        'why it exists and nobody is accountable for remembering.',
    };
  }
  if (f.hypothesis.trim() === '') {
    return { accept: false, reason: 'no stated hypothesis, so nobody can later tell what resolving it would mean' };
  }
  return { accept: true };
}

/* ------------------------------------------------------------------------------------------- */

export const LIFECYCLE_STAGES = ['creation', 'rollout', 'monitoring', 'resolution', 'cleanup'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** How each stage fails when nobody owns it. These are the observable signatures. */
export const UNOWNED_FAILURE: Record<LifecycleStage, string> = {
  creation: 'a flag exists with no stated purpose, so nobody can later tell what resolving it would mean',
  rollout: 'the flag is set to 100% on the day it ships and the experiment never happens',
  monitoring: 'a degraded variant runs for weeks because nobody was watching the flag own metrics',
  resolution: 'the expiry date passes silently and the flag becomes permanent by default',
  cleanup: 'the flag is set to 100% and abandoned, leaving a dead branch nobody dares delete',
};

export type FlagStatus = 'active' | 'expired' | 'abandoned-at-100' | 'never-rolled-out';

export function classify(f: Flag, todayIso: string): FlagStatus {
  const expired = f.expiryIso !== null && f.expiryIso < todayIso;
  if (expired && f.rolloutPercent === 100) return 'abandoned-at-100';
  if (expired) return 'expired';
  if (f.rolloutPercent === 0) return 'never-rolled-out';
  return 'active';
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Bounded-Flag-Count Rule, and the cost the chapter is careful to locate correctly.
 *
 * The cost of a flag is not the line that checks it. The direct line-of-code cost is negligible, and
 * saying so is what makes the real argument credible. The cost is the testing and reasoning burden of
 * every path the flag adds.
 *
 * Two numbers matter and they are very different. The theoretical bound is 2^n, which for 180 flags is a
 * number with no operational meaning. The number a developer actually pays is per-path: how many flags
 * gate the file in front of them. That is the one worth reporting.
 */
export interface ReasoningTax {
  liveFlagCount: number;
  /** The theoretical combinatorial bound. Reported to show why it is the wrong number to use. */
  theoreticalPathBound: number;
  /** Paths a developer must consider when touching the busiest gated file. */
  worstCasePathsPerChange: number;
  /** Mean flags gating any single path. */
  meanFlagsPerPath: number;
  note: string;
}

export function reasoningTax(flags: Flag[]): ReasoningTax {
  const byPath = new Map<string, number>();
  for (const f of flags) {
    for (const p of f.gatedPaths) byPath.set(p, (byPath.get(p) ?? 0) + 1);
  }
  const counts = [...byPath.values()];
  const worstFlags = counts.length === 0 ? 0 : Math.max(...counts);

  return {
    liveFlagCount: flags.length,
    theoreticalPathBound: 2 ** flags.length,
    worstCasePathsPerChange: 2 ** worstFlags,
    meanFlagsPerPath: counts.length === 0 ? 0 : counts.reduce((a, c) => a + c, 0) / counts.length,
    note:
      `the 2^${flags.length} bound is not the number anyone pays. A developer touching the busiest gated ` +
      `path reasons about ${2 ** worstFlags} combinations, and that is the number that inflates a ` +
      `one-line fix.`,
  };
}

/**
 * The graveyard cleanup, sized honestly.
 *
 * The chapter's claim is that retiring 180-plus flags down to the dozen still active is a one-sprint
 * cleanup that attacks both the lead time and the change failure rate directly. What makes it a sprint
 * rather than a quarter is that the expired flags are removable mechanically: the decision was already
 * made when the expiry passed, so cleanup is deletion rather than adjudication.
 *
 * The ones that cost real time are the abandoned-at-100 flags, where a dead branch has to be removed from
 * live code, and the never-rolled-out flags, where nobody knows whether the behaviour works.
 */
export interface CleanupPlan {
  total: number;
  keep: string[];
  mechanicalDeletions: string[];
  requiresJudgement: string[];
  note: string;
}

export function planCleanup(flags: Flag[], todayIso: string): CleanupPlan {
  const keep: string[] = [];
  const mechanical: string[] = [];
  const judgement: string[] = [];

  for (const f of flags) {
    const status = classify(f, todayIso);
    if (status === 'active') keep.push(f.key);
    else if (status === 'expired') mechanical.push(f.key);
    else judgement.push(f.key);
  }

  return {
    total: flags.length,
    keep,
    mechanicalDeletions: mechanical,
    requiresJudgement: judgement,
    note:
      `${mechanical.length} are mechanical: the decision was made when the expiry passed, so cleanup is ` +
      `deletion rather than adjudication. ${judgement.length} need a person, because an abandoned ` +
      `100% flag has a dead branch in live code and a never-rolled-out flag has behaviour nobody has seen work.`,
  };
}
