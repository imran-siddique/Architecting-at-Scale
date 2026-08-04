/**
 * The degraded checkout, showing the mechanisms composing.
 *
 * Chapter 12's most useful passage is not any single mechanism, it is the six-step walkthrough where
 * they combine: a breaker opens, a flag disables dynamic pricing, cached pricing serves, the payment
 * intent is captured, the order is queued, and the customer is acknowledged.
 *
 * What matters at the end is not that checkout survived. It is what did NOT happen: nobody was
 * charged without an order, no price was invented, and no audit entry was skipped. The correctness
 * floor held while everything above it degraded.
 */

export interface DegradedContext {
  pricingServiceHealthy: boolean;
  dynamicPricingFlagEnabled: boolean;
  cachedPriceAvailable: boolean;
  paymentGatewayHealthy: boolean;
  fulfilmentQueueAvailable: boolean;
}

export interface StepRecord {
  step: number;
  action: string;
  degraded: boolean;
}

export interface CheckoutResult {
  accepted: boolean;
  steps: StepRecord[];
  /** True when the payment intent was captured. The P0P0. */
  paymentIntentCaptured: boolean;
  /** True when the customer was charged with no order recorded. Must never happen. */
  chargedWithoutOrder: boolean;
  /** True when a price was served that nobody could account for. Must never happen. */
  inventedPrice: boolean;
  auditWritten: boolean;
  customerMessage: string;
}

export function attemptCheckout(ctx: DegradedContext): CheckoutResult {
  const steps: StepRecord[] = [];
  let degradedPricing = false;

  // 1. Pricing. Breaker opens on an unhealthy dependency.
  if (!ctx.pricingServiceHealthy) {
    steps.push({ step: 1, action: 'pricing breaker opened', degraded: true });
    // 2. The flag disables dynamic pricing, which is what makes the fallback reachable.
    steps.push({ step: 2, action: 'dynamic-pricing flag disabled', degraded: true });
    degradedPricing = true;
  } else {
    steps.push({ step: 1, action: 'dynamic pricing served', degraded: false });
  }

  // 3. Cached pricing, or refuse. Refusing is correct: an invented price is worse than no sale.
  if (degradedPricing) {
    if (!ctx.cachedPriceAvailable) {
      steps.push({ step: 3, action: 'no cached price available, checkout refused', degraded: true });
      return {
        accepted: false,
        steps,
        paymentIntentCaptured: false,
        chargedWithoutOrder: false,
        inventedPrice: false,
        auditWritten: true,
        customerMessage: 'We cannot confirm pricing right now. Nothing has been charged.',
      };
    }
    steps.push({ step: 3, action: 'cached pricing served', degraded: true });
  }

  // 4. The P0P0: capture the payment intent BEFORE anything that can fail leaves a charge behind.
  if (!ctx.paymentGatewayHealthy) {
    steps.push({ step: 4, action: 'payment gateway unavailable, checkout refused', degraded: true });
    return {
      accepted: false,
      steps,
      paymentIntentCaptured: false,
      chargedWithoutOrder: false,
      inventedPrice: false,
      auditWritten: true,
      customerMessage: 'Payment is temporarily unavailable. Nothing has been charged.',
    };
  }
  steps.push({ step: 4, action: 'payment intent captured', degraded: false });

  // 5. Queue the order. If the queue is down we must NOT leave a captured intent unmatched.
  if (!ctx.fulfilmentQueueAvailable) {
    steps.push({ step: 5, action: 'queue unavailable, payment intent released', degraded: true });
    return {
      accepted: false,
      steps,
      paymentIntentCaptured: false, // released, deliberately
      chargedWithoutOrder: false,
      inventedPrice: false,
      auditWritten: true,
      customerMessage: 'We could not complete your order. Nothing has been charged.',
    };
  }
  steps.push({ step: 5, action: 'order queued for fulfilment', degraded: degradedPricing });

  // 6. Acknowledge.
  steps.push({ step: 6, action: 'customer acknowledged', degraded: degradedPricing });

  return {
    accepted: true,
    steps,
    paymentIntentCaptured: true,
    chargedWithoutOrder: false,
    inventedPrice: false,
    auditWritten: true,
    customerMessage: degradedPricing
      ? 'Order confirmed. Final pricing will be confirmed by email.'
      : 'Order confirmed.',
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Fairness within a traffic class.
 *
 * Chapter 12 separates two things that get conflated: PRIORITY decides which class sheds first, and
 * FAIRNESS decides who inside a class absorbs it. A system with perfect priority ordering can still
 * let one tenant consume the entire P1 budget, and every other P1 tenant experiences that as an
 * outage they did nothing to cause.
 */
export interface Consumer {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  requestsInWindow: number;
  /** Cost-weighted units, since not all requests cost the same. */
  costUnits: number;
}

export interface FairShareResult {
  admitted: string[];
  throttled: string[];
  /** Share of the class budget consumed by its largest consumer. */
  largestShare: number;
}

/**
 * Per-consumer quota inside a class. `budgetUnits` is what the class as a whole may spend.
 *
 * Cost weighting matters: limiting by request count lets an expensive caller consume the class while
 * staying inside a numeric quota.
 */
export function applyFairShare(
  consumers: Consumer[],
  priority: 'P0' | 'P1' | 'P2',
  budgetUnits: number,
): FairShareResult {
  const inClass = consumers.filter((c) => c.priority === priority);
  if (inClass.length === 0) return { admitted: [], throttled: [], largestShare: 0 };

  const perConsumer = budgetUnits / inClass.length;
  const admitted: string[] = [];
  const throttled: string[] = [];

  for (const c of inClass) {
    if (c.costUnits <= perConsumer) admitted.push(c.id);
    else throttled.push(c.id);
  }

  const total = inClass.reduce((a, c) => a + c.costUnits, 0);
  const largest = Math.max(...inClass.map((c) => c.costUnits));

  return { admitted, throttled, largestShare: total === 0 ? 0 : largest / total };
}
