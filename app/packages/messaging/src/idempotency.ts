/**
 * Idempotency, and the double-charge bug it fixes.
 *
 * ShopFlow's Chapter 8 telemetry: three double-charge incidents this month, from checkout retrying
 * without an idempotency key. That is the headline correctness defect of the chapter, and it has
 * two independent causes that are easy to conflate:
 *
 *   1. The KEY was wrong. An attempt-number-based key produces a different value on every retry,
 *      so deduplication cannot possibly work. Retry 1 and retry 2 look like different operations
 *      because, to the dedup store, they are.
 *
 *   2. The CHECK was not atomic. Even with a correct key, a check-then-act sequence lets two
 *      concurrent deliveries both pass before either records anything. This is the chapter's
 *      Optimistic Idempotency Key anti-pattern.
 *
 * Fixing one and not the other still charges the customer twice, so both are enforced here and
 * both are tested separately.
 */

/* ------------------------------------------------------------------------------------------- */

export interface PaymentOperation {
  orderId: string;
  /** The payment intent. Stable across retries of the same logical payment. */
  paymentIntentId: string;
  amountCents: number;
}

/**
 * The stable key: `{order_id}_{payment_intent_id}`.
 *
 * Deliberately excludes the attempt number, the timestamp, and any request id, because every one
 * of those changes between retries of the same logical operation. The key must identify the
 * OPERATION, not the delivery.
 *
 * The amount is excluded too, and that is a judgement worth stating: including it would make a
 * corrected amount look like a new operation, which is usually not what you want for a capture
 * against a single intent. Where amount is genuinely part of operation identity, put it in the
 * intent rather than in the key.
 */
export function paymentIdempotencyKey(op: PaymentOperation): string {
  if (!op.orderId || !op.paymentIntentId) {
    throw new Error('a stable idempotency key requires both orderId and paymentIntentId');
  }
  return `${op.orderId}_${op.paymentIntentId}`;
}

/**
 * The key ShopFlow had, kept only so a test can prove it cannot work.
 * Do not use it. It is here as evidence, not as an option.
 */
export function brokenAttemptBasedKey(op: PaymentOperation, attempt: number): string {
  return `${op.orderId}_attempt_${attempt}`;
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The deduplication store.
 *
 * `claim` must be a single atomic operation, which is why the interface has no `exists` method.
 * Offering one would invite the check-then-act sequence that is the whole anti-pattern, so the
 * shape of the interface removes the option.
 */
export interface DedupStore {
  /** Returns true only for the caller that won. Redis SET key val NX EX ttl. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Release a claim so a failed operation can be retried rather than silently swallowed. */
  release(key: string): Promise<void>;
}

/**
 * The authoritative record.
 *
 * Chapter 8 is specific: the dedup record that decides the outcome lives in the application
 * database as a unique constraint, committed in the same transaction as the business write.
 * Redis is a fast pre-check only.
 *
 * The reason is that Redis can lose the key. Eviction under memory pressure, a failover with
 * asynchronous replication, a flush during an incident: all of them are ordinary operational
 * events, and any of them turns a Redis-only design back into a double charge. A unique constraint
 * cannot lose the row without losing the payment too.
 */
export interface AuthoritativeLedger {
  /**
   * Record the operation and perform the business write atomically.
   * Throws `DuplicateOperationError` if the key already exists.
   */
  commit(key: string, op: PaymentOperation): Promise<void>;
}

export class DuplicateOperationError extends Error {
  constructor(readonly key: string) {
    super(`operation already committed: ${key}`);
    this.name = 'DuplicateOperationError';
  }
}

export type CaptureOutcome = 'captured' | 'duplicate-suppressed' | 'failed';

export interface CaptureResult {
  outcome: CaptureOutcome;
  key: string;
  /** Which layer suppressed the duplicate. Both must work; either alone is insufficient. */
  suppressedBy?: 'dedup-store' | 'authoritative-ledger';
  error?: Error;
}

/**
 * Capture a payment exactly once under at-least-once delivery.
 *
 * Two layers, in this order, on purpose:
 *   - The dedup store is a cheap pre-check that stops the common case before it reaches the
 *     database at all.
 *   - The unique constraint is the guarantee, and it holds when the pre-check has lost its state.
 *
 * `ttlSeconds` must exceed the broker's retention window, or a redelivery arriving after the key
 * expires is indistinguishable from a new operation to the pre-check. The constraint still catches
 * it, which is precisely why the constraint is the authoritative half.
 */
export async function capturePaymentOnce(
  op: PaymentOperation,
  deps: { dedup: DedupStore; ledger: AuthoritativeLedger; ttlSeconds: number },
): Promise<CaptureResult> {
  const key = paymentIdempotencyKey(op);

  const won = await deps.dedup.claim(key, deps.ttlSeconds);
  if (!won) {
    return { outcome: 'duplicate-suppressed', key, suppressedBy: 'dedup-store' };
  }

  try {
    await deps.ledger.commit(key, op);
    return { outcome: 'captured', key };
  } catch (err) {
    if (err instanceof DuplicateOperationError) {
      // The pre-check missed it, the constraint caught it. This is the path that exists because
      // Redis can lose a key, and it is the reason the design is not Redis-only.
      return { outcome: 'duplicate-suppressed', key, suppressedBy: 'authoritative-ledger' };
    }
    // A genuine failure. Release the claim so a redelivery is retried rather than swallowed as a
    // duplicate, which would lose the payment entirely.
    await deps.dedup.release(key);
    return { outcome: 'failed', key, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The Duplicate Budget Rule.
 *
 * "Define a measurable acceptable duplicate rate for each consumer before going to production.
 * For payment capture: zero tolerance. For analytics events: 0.01%. For notification emails: one
 * duplicate per order." The tolerance determines how much machinery the consumer needs, so it is
 * a design input rather than an operational afterthought.
 */
export interface DuplicateBudget {
  consumer: string;
  /** Acceptable duplicate rate, 0..1. Zero means exactly-once is required. */
  tolerance: number;
  rationale: string;
}

export const SHOPFLOW_DUPLICATE_BUDGETS: DuplicateBudget[] = [
  { consumer: 'payment-capture', tolerance: 0,
    rationale: 'A duplicate is a double charge. Requires atomic claim plus a unique constraint.' },
  { consumer: 'inventory-reserve', tolerance: 0,
    rationale: 'A duplicate oversells stock and cannot be corrected without cancelling an order.' },
  { consumer: 'order-confirmation-email', tolerance: 0.001,
    rationale: 'One duplicate email per thousand orders is an annoyance, not an incident.' },
  { consumer: 'analytics-ingest', tolerance: 0.0001,
    rationale: 'A 0.01% duplicate rate is inside the noise floor of the metrics it feeds.' },
];

/** Consumers with zero tolerance need the full mechanism. Anything less is a design error. */
export function requiresExactlyOnceMachinery(b: DuplicateBudget): boolean {
  return b.tolerance === 0;
}
