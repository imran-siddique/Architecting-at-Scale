/**
 * The Retry Configuration Rule.
 *
 * Chapter 7 states it without hedging: "A retry policy without exponential backoff, jitter, and a
 * retry budget is not a resilience mechanism. It is a load amplifier with a delay. All three
 * controls are required."
 *
 * That is a testable claim rather than a preference, and it explains ShopFlow's opening incident.
 * The Pricing service was not down. It was merely slow. Naive retries turned a latency problem
 * into a load problem, the amplified traffic exhausted the shared connection pool, and the
 * checkout path took a 4.2% error rate from a dependency that never actually failed.
 *
 * `amplificationFactor` below is the arithmetic of that incident, and `retry` is the version that
 * does not cause it.
 */

export interface RetryPolicy {
  /** Total attempts including the first. 3 means one call and two retries. */
  attempts: number;
  baseDelayMs: number;
  /** Exponential base. 2 doubles each time. 1 means no backoff at all. */
  multiplier: number;
  /** Full jitter when true. Without it, retries from many callers align into a new spike. */
  jitter: boolean;
  /**
   * Retry budget: the share of total requests allowed to be retries, 0..1. When exceeded,
   * retries are refused even if the policy would otherwise allow them. This is the control that
   * bounds amplification across the whole fleet rather than per call.
   */
  budgetRatio: number;
  maxDelayMs?: number;
}

export const NAIVE: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 0,
  multiplier: 1,
  jitter: false,
  budgetRatio: 1,
};

export const SOUND: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 50,
  multiplier: 2,
  jitter: true,
  budgetRatio: 0.1,
  maxDelayMs: 2000,
};

/**
 * Load multiple a policy imposes on a struggling dependency, in the worst case where every
 * attempt fails.
 *
 * The point is that this number is greater than 1 for any retry policy, so a dependency that is
 * already slow receives MORE load precisely when it can least absorb it. The budget is what caps
 * it; backoff and jitter only spread it out in time.
 */
export function amplificationFactor(p: RetryPolicy): number {
  const perCall = p.attempts;
  // The budget caps retries fleet-wide: 1 original plus at most budgetRatio of total traffic.
  const budgetCap = 1 + p.budgetRatio * perCall;
  return Math.min(perCall, budgetCap);
}

/** Delay before attempt `n` (1-indexed; attempt 1 has no delay). */
export function delayFor(p: RetryPolicy, attempt: number, random = Math.random): number {
  if (attempt <= 1) return 0;
  const exponential = p.baseDelayMs * Math.pow(p.multiplier, attempt - 2);
  const capped = Math.min(exponential, p.maxDelayMs ?? Infinity);
  // Full jitter: uniform in [0, capped]. Equal jitter would still leave a synchronized floor,
  // which is the thing that recreates the spike.
  return p.jitter ? random() * capped : capped;
}

/**
 * Whether a policy is a resilience mechanism at all, per the rule. All three controls required.
 * Returns the missing ones, so the failure message can name them.
 */
export function policyDefects(p: RetryPolicy): string[] {
  const missing: string[] = [];
  if (p.multiplier <= 1 || p.baseDelayMs <= 0) missing.push('exponential backoff');
  if (!p.jitter) missing.push('jitter');
  if (p.budgetRatio >= 1) missing.push('retry budget');
  return missing;
}

/**
 * The Idempotency Rule.
 *
 * "Reads retry freely. Non-idempotent writes without a deduplication key must not be retried:
 * return the failure to the caller and let a human or a saga decide, because a duplicate charge
 * is a worse outcome than a failed one."
 */
export interface Operation {
  kind: 'read' | 'write';
  idempotent?: boolean;
  /** Server-side deduplication key. Makes a non-idempotent write safe to retry. */
  idempotencyKey?: string;
  name?: string;
}

export function isRetryable(op: Operation): boolean {
  if (op.kind === 'read') return true;
  return op.idempotent === true || typeof op.idempotencyKey === 'string';
}

/** Tracks retry spend so the budget is enforced across calls, not just within one. */
export class RetryBudget {
  private total = 0;
  private retries = 0;
  constructor(private readonly ratio: number) {}

  /** Called once per logical request, before the first attempt. */
  recordRequest(): void {
    this.total++;
  }

  /** Returns false when the budget is exhausted, in which case the retry must not happen. */
  tryConsume(): boolean {
    if (this.retries + 1 > this.total * this.ratio) return false;
    this.retries++;
    return true;
  }

  get spent(): { total: number; retries: number; ratio: number } {
    return { total: this.total, retries: this.retries, ratio: this.total ? this.retries / this.total : 0 };
  }
}

export interface RetryOutcome<T> {
  value?: T;
  error?: Error;
  attemptsMade: number;
  /** Total delay slept, useful for asserting that backoff actually happened. */
  totalDelayMs: number;
  refusedBy?: 'idempotency' | 'budget';
}

/**
 * Execute `fn` under `policy`.
 *
 * Refuses outright for a non-idempotent write with no deduplication key, which is the rule's
 * hard case: the failure goes back to the caller rather than risking a duplicate charge.
 */
export async function retry<T>(
  op: Operation,
  policy: RetryPolicy,
  fn: (attempt: number) => Promise<T>,
  deps: { budget?: RetryBudget; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<RetryOutcome<T>> {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  deps.budget?.recordRequest();

  let totalDelayMs = 0;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    if (attempt > 1) {
      if (!isRetryable(op)) {
        return { error: lastError, attemptsMade: attempt - 1, totalDelayMs, refusedBy: 'idempotency' };
      }
      if (deps.budget && !deps.budget.tryConsume()) {
        return { error: lastError, attemptsMade: attempt - 1, totalDelayMs, refusedBy: 'budget' };
      }
      const d = delayFor(policy, attempt, random);
      totalDelayMs += d;
      await sleep(d);
    }
    try {
      return { value: await fn(attempt), attemptsMade: attempt, totalDelayMs };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  return { error: lastError, attemptsMade: policy.attempts, totalDelayMs };
}
