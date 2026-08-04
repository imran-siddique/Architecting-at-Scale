/**
 * Resource contention: the five-step diagnostic, and the Physical Separation Rule.
 *
 * ShopFlow's case: the code indexing job (P2, background) and search queries (P0, user-facing) share
 * node compute. During indexing windows the P2 job takes 85% of node CPU, leaving 15% for P0 search,
 * and search p99 goes from 95ms to 210ms. Search traffic over the same window is flat.
 *
 * That last fact is the whole diagnosis. Step 2 of the sequence is the one teams skip and the one that
 * decides everything: if P0 traffic rose proportionally, this is a capacity problem and separation
 * will not help.
 */

export interface ContentionObservation {
  windowStart: string;
  windowEnd: string;
  p0LatencyNormalMs: number;
  p0LatencyDegradedMs: number;
  /** Ratio of P0 traffic in the window to P0 traffic outside it. 1.0 means flat. */
  p0TrafficRatio: number;
  /** Does the window align with a scheduled background job, over repeated occurrences? */
  alignedWithScheduledJob: boolean;
  repetitionsObserved: number;
  /** Share of the shared resource taken by the correlated workload during the window. */
  correlatedWorkloadResourceShare: number;
  /** Confirmed co-location on the same node pool, connection pool or IOPS budget. */
  coLocated: boolean;
}

export type Diagnosis =
  | { verdict: 'contention'; degradationMultiple: number; p0HeadroomShare: number; fix: string }
  | { verdict: 'capacity'; reason: string }
  | { verdict: 'inconclusive'; reason: string };

/**
 * The five steps, in order. Steps 2 and 5 are refusals, not confirmations.
 */
export function diagnose(o: ContentionObservation): Diagnosis {
  // 1. The window is recorded precisely. A vague "search felt slow" correlates against nothing.
  if (!o.windowStart || !o.windowEnd) {
    return {
      verdict: 'inconclusive',
      reason: 'the window was not recorded precisely, so it cannot be correlated against anything',
    };
  }

  // 2. Did P0 traffic also rise? The step teams skip, and the one that decides everything.
  if (o.p0TrafficRatio > 1.2) {
    return {
      verdict: 'capacity',
      reason:
        `P0 traffic rose ${o.p0TrafficRatio}x over the window. This is a capacity problem and ` +
        `physical separation will not help: the workload needs more resource, not a different neighbour.`,
    };
  }

  // 3. Alignment with a scheduled job, over repetitions rather than once.
  if (!o.alignedWithScheduledJob || o.repetitionsObserved < 2) {
    return {
      verdict: 'inconclusive',
      reason:
        `${o.repetitionsObserved} aligned occurrence(s). Look for alignment rather than coincidence: ` +
        `two or three repetitions before calling it.`,
    };
  }

  // 5. Confirm co-location before optimizing anything.
  if (!o.coLocated) {
    return {
      verdict: 'inconclusive',
      reason:
        'co-location is unconfirmed. Optimizing a workload that turns out not to be co-located is ' +
        'engineering time spent on the wrong thing.',
    };
  }

  // 4. How much of the shared resource did it take while it ran?
  return {
    verdict: 'contention',
    degradationMultiple: o.p0LatencyDegradedMs / o.p0LatencyNormalMs,
    p0HeadroomShare: 1 - o.correlatedWorkloadResourceShare,
    fix: 'physical separation: a different node pool, not a resource limit on the same one',
  };
}

export const SHOPFLOW_INDEXING_CONTENTION: ContentionObservation = {
  windowStart: '2026-08-03T09:15:00Z',
  windowEnd: '2026-08-03T10:40:00Z',
  p0LatencyNormalMs: 95,
  p0LatencyDegradedMs: 210,
  p0TrafficRatio: 1.0, // flat
  alignedWithScheduledJob: true,
  repetitionsObserved: 3,
  correlatedWorkloadResourceShare: 0.85,
  coLocated: true,
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The Physical Separation Rule: P0 and P2 workloads must not share physical compute. Not logical
 * partitions on the same node. Not Kubernetes resource limits on the same node pool. Different nodes.
 *
 * This is what makes the chapter's Option A and Option B incomparable, and it is easy to miss because
 * they are presented side by side with dollar figures.
 *
 * Option A separates the indexing job onto a dedicated pool, which satisfies the rule.
 * Option B halves the indexing job's CPU consumption, taking it from 85% to about 43%, which leaves
 * P0 search and a P2 batch job on the same physical compute. That is still a violation. It is a
 * smaller violation, and 43% of a shared node is still enough to move a p99.
 *
 * So the two options do not address the same problem, and comparing their costs implies they do.
 */
export interface Placement {
  workload: string;
  tier: 'P0' | 'P1' | 'P2';
  nodePool: string;
  /** Whether isolation is by dedicated nodes or by limits on a shared pool. */
  isolation: 'dedicated-nodes' | 'resource-limits-shared-pool' | 'none';
  resourceShareAtPeak: number;
}

export interface SeparationViolation {
  p0: string;
  p2: string;
  nodePool: string;
  p2ShareAtPeak: number;
  note: string;
}

export function checkPhysicalSeparation(placements: Placement[]): SeparationViolation[] {
  const violations: SeparationViolation[] = [];

  for (const p0 of placements.filter((p) => p.tier === 'P0')) {
    for (const p2 of placements.filter((p) => p.tier === 'P2')) {
      if (p0.nodePool !== p2.nodePool) continue;
      if (p2.isolation === 'dedicated-nodes' && p0.isolation === 'dedicated-nodes') continue;

      violations.push({
        p0: p0.workload,
        p2: p2.workload,
        nodePool: p0.nodePool,
        p2ShareAtPeak: p2.resourceShareAtPeak,
        note:
          p2.isolation === 'resource-limits-shared-pool'
            ? 'resource limits on a shared pool are not physical separation. A P2 inside its limit ' +
              'still takes IOPS, cache lines and scheduler time from the P0 beside it.'
            : 'P0 and P2 share physical compute with no isolation at all.',
      });
    }
  }

  return violations;
}

/**
 * The Background Budget Rule: every P2 background job needs an explicit resource budget. Four fields,
 * all mandatory, because a job with three of them still has one unbounded dimension.
 */
export interface BackgroundBudget {
  job: string;
  maxCpuPercent?: number;
  maxMemoryMb?: number;
  maxIops?: number;
  maxExecutionWindowMinutes?: number;
}

export function validateBackgroundBudget(b: BackgroundBudget): string[] {
  const missing: string[] = [];
  if (b.maxCpuPercent === undefined) missing.push('maxCpuPercent');
  if (b.maxMemoryMb === undefined) missing.push('maxMemoryMb');
  if (b.maxIops === undefined) missing.push('maxIops');
  if (b.maxExecutionWindowMinutes === undefined) missing.push('maxExecutionWindowMinutes');
  return missing;
}
