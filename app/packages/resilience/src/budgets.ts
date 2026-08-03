/**
 * Bulkheads, the timeout hierarchy, and priority-ordered load shedding.
 *
 * These three are the reason ShopFlow's opening incident was possible. A merely-slow Pricing
 * service exhausted a SHARED connection pool, so a P2 dependency took down the P0 checkout path.
 * The Bulkhead Mandate exists to make that structurally impossible rather than unlikely.
 */

export type Priority = 'P0' | 'P1' | 'P2';

/* -------------------------------------------------------------------------------------------
 * The Bulkhead Mandate
 *
 * "Every P0 critical path must have a dedicated resource pool that cannot be consumed by
 * non-critical paths. You cannot guarantee P0 availability if P0 and P2 paths share a resource
 * pool. This is non-negotiable before GA."
 * ------------------------------------------------------------------------------------------- */

export interface Bulkhead {
  name: string;
  priority: Priority;
  /** Maximum concurrent operations. A semaphore, a thread pool, or a connection pool. */
  limit: number;
}

export class BulkheadSet {
  private readonly inUse = new Map<string, number>();
  private readonly byName = new Map<string, Bulkhead>();
  /** Rejections per bulkhead. A rejection is the mechanism working, not a failure. */
  readonly rejected = new Map<string, number>();

  constructor(bulkheads: Bulkhead[]) {
    for (const b of bulkheads) {
      if (this.byName.has(b.name)) throw new Error(`duplicate bulkhead: ${b.name}`);
      if (b.limit < 1) throw new RangeError(`bulkhead ${b.name} needs a limit of at least 1`);
      this.byName.set(b.name, b);
      this.inUse.set(b.name, 0);
      this.rejected.set(b.name, 0);
    }
  }

  /** Try to acquire a slot. Returns false immediately rather than queueing: fail fast, not slow. */
  acquire(name: string): boolean {
    const b = this.byName.get(name);
    if (!b) throw new Error(`no bulkhead named ${name}`);
    const used = this.inUse.get(name)!;
    if (used >= b.limit) {
      this.rejected.set(name, this.rejected.get(name)! + 1);
      return false;
    }
    this.inUse.set(name, used + 1);
    return true;
  }

  release(name: string): void {
    const used = this.inUse.get(name) ?? 0;
    this.inUse.set(name, Math.max(0, used - 1));
  }

  available(name: string): number {
    return this.byName.get(name)!.limit - this.inUse.get(name)!;
  }

  /**
   * The mandate as an assertion: no P0 bulkhead may share a name, and therefore a pool, with a
   * lower-priority path. Trivial here by construction, which is the point: the isolation is a
   * property of the configuration rather than of anyone's discipline.
   */
  assertP0Isolated(): void {
    const p0 = [...this.byName.values()].filter((b) => b.priority === 'P0');
    if (p0.length === 0) throw new Error('no P0 bulkhead declared: the critical path has no reserved capacity');
  }
}

/* -------------------------------------------------------------------------------------------
 * The Timeout Hierarchy Rule
 *
 * "At every layer, the timeout must be strictly less than the timeout of the layer above it, with
 * enough margin for processing time and network variance. Define the hierarchy from the outside in
 * before configuring any individual timeout."
 * ------------------------------------------------------------------------------------------- */

export interface Layer {
  name: string;
  timeoutMs: number;
}

export interface HierarchyProblem {
  outer: string;
  inner: string;
  reason: 'inner-not-less' | 'insufficient-margin';
  marginMs: number;
}

/**
 * Validate a call stack ordered from the outside in.
 *
 * An inverted or equal timeout is the classic cause of a retry storm: the outer layer gives up
 * and retries while the inner layer is still working, so the original request keeps running and
 * the retry adds load on top of it. Nothing is cancelled and everything is duplicated.
 */
export function validateTimeoutHierarchy(
  layers: Layer[],
  minimumMarginMs = 100,
): HierarchyProblem[] {
  const problems: HierarchyProblem[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const outer = layers[i]!;
    const inner = layers[i + 1]!;
    const margin = outer.timeoutMs - inner.timeoutMs;
    if (margin <= 0) {
      problems.push({ outer: outer.name, inner: inner.name, reason: 'inner-not-less', marginMs: margin });
    } else if (margin < minimumMarginMs) {
      problems.push({ outer: outer.name, inner: inner.name, reason: 'insufficient-margin', marginMs: margin });
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------------------------
 * The Load Shedding Priority Rule
 *
 * "P2 requests are shed at 80% capacity utilization. P1 at 90%. P0 only at 100%, and only with an
 * explicit alert. A system that sheds P0 checkout requests to serve P2 recommendations has
 * inverted its business priorities."
 * ------------------------------------------------------------------------------------------- */

export const SHED_THRESHOLDS: Record<Priority, number> = { P2: 0.80, P1: 0.90, P0: 1.00 };

export interface ShedDecision {
  admit: boolean;
  /** True when a P0 request is being shed, which must always page someone. */
  alert: boolean;
  reason?: string;
}

export function shouldShed(priority: Priority, utilization: number): ShedDecision {
  const threshold = SHED_THRESHOLDS[priority];
  if (utilization < threshold) return { admit: true, alert: false };

  return {
    admit: false,
    // Shedding P0 means the service is beyond its provisioned envelope. That is not a routine
    // event to be absorbed quietly; it is a capacity failure that someone has to know about.
    alert: priority === 'P0',
    reason:
      priority === 'P0'
        ? `shedding P0 at ${(utilization * 100).toFixed(0)}% utilization: operating beyond the provisioned capacity envelope`
        : `shedding ${priority} at ${(utilization * 100).toFixed(0)}% utilization to protect higher priorities`,
  };
}

/**
 * Check that a shedding configuration has not inverted its priorities.
 *
 * A system that sheds P0 before P2 is not misconfigured in a subtle way, it is backwards, and it
 * will do the wrong thing precisely during the incident it was installed for.
 */
export function assertPriorityOrdering(thresholds: Record<Priority, number> = SHED_THRESHOLDS): void {
  if (!(thresholds.P2 < thresholds.P1 && thresholds.P1 < thresholds.P0)) {
    throw new Error(
      `load shedding priorities are inverted: P2 ${thresholds.P2}, P1 ${thresholds.P1}, P0 ${thresholds.P0}. ` +
        `Lower-priority traffic must be shed first.`,
    );
  }
}
