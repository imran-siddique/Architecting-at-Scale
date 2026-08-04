/**
 * The gap between infrastructure health and user-journey success.
 *
 * ShopFlow's Chapter 11 problem in one sentence: every dashboard is green and 0.3% of customers are
 * not getting their orders. Availability reads 99.9% because availability measures whether services
 * responded, and the customers in that 0.3% received a response. It was just the wrong one, or the
 * right one for a journey that never completed.
 *
 * The two numbers below are computed from the same request data on purpose, so the gap is visibly a
 * property of what you choose to measure rather than of two different systems.
 */

export interface RequestOutcome {
  journeyId: string;
  step: string;
  /** The service answered. This is what infrastructure availability counts. */
  serviceResponded: boolean;
  /** HTTP-level success. A 200 that returns an empty cart is still true here. */
  httpOk: boolean;
  /** The step achieved its business outcome. This is what the customer experiences. */
  outcomeAchieved: boolean;
}

export interface JourneySpec {
  name: string;
  /** Steps that must all achieve their outcome for the journey to have succeeded. */
  requiredSteps: string[];
}

export interface HealthReport {
  /** Share of requests where the service responded. Green dashboards live here. */
  infrastructureAvailability: number;
  /** Share of requests with a 2xx. Still not the customer's experience. */
  httpSuccessRate: number;
  /** Share of JOURNEYS that completed every required step. */
  journeySuccessRate: number;
  /**
   * The silent-failure floor: journeys that failed while every request in them responded.
   * These are invisible to infrastructure monitoring by construction.
   */
  silentFailureRate: number;
  silentlyFailedJourneys: string[];
}

export function assessHealth(outcomes: RequestOutcome[], spec: JourneySpec): HealthReport {
  const total = outcomes.length;
  const responded = outcomes.filter((o) => o.serviceResponded).length;
  const http2xx = outcomes.filter((o) => o.httpOk).length;

  const byJourney = new Map<string, RequestOutcome[]>();
  for (const o of outcomes) {
    const list = byJourney.get(o.journeyId) ?? [];
    list.push(o);
    byJourney.set(o.journeyId, list);
  }

  let succeeded = 0;
  const silent: string[] = [];

  for (const [id, steps] of byJourney) {
    const complete = spec.requiredSteps.every((required) =>
      steps.some((s) => s.step === required && s.outcomeAchieved),
    );
    if (complete) {
      succeeded++;
      continue;
    }
    // Failed. Was it visible to infrastructure monitoring?
    const everythingResponded = steps.every((s) => s.serviceResponded && s.httpOk);
    if (everythingResponded) silent.push(id);
  }

  const journeys = byJourney.size;
  return {
    infrastructureAvailability: responded / total,
    httpSuccessRate: http2xx / total,
    journeySuccessRate: succeeded / journeys,
    silentFailureRate: silent.length / journeys,
    silentlyFailedJourneys: silent,
  };
}

export const CHECKOUT_JOURNEY: JourneySpec = {
  name: 'checkout',
  requiredSteps: ['add-to-cart', 'reserve-inventory', 'authorize-payment', 'confirm-order'],
};

/**
 * The First Two Metrics Rule.
 *
 * Chapter 11 is deliberate about starting with two outcome metrics rather than a dashboard: checkout
 * completion and payment confirmation. The reason is that an outcome metric only earns its place if
 * someone acts on it, and a team that instruments thirty at once acts on none of them.
 *
 * Everything else is explicitly parked, which is the part that takes discipline.
 */
export interface OutcomeMetric {
  name: string;
  question: string;
  firstTwo: boolean;
}

export const OUTCOME_METRICS: OutcomeMetric[] = [
  { name: 'checkout-completion-rate', question: 'Did customers who started checkout finish it?', firstTwo: true },
  { name: 'payment-confirmation-rate', question: 'Did authorized payments actually confirm?', firstTwo: true },
  // Parked. Real metrics, and not first.
  { name: 'search-result-relevance', question: 'Did search return something useful?', firstTwo: false },
  { name: 'recommendation-click-through', question: 'Are recommendations worth their cost?', firstTwo: false },
  { name: 'page-load-satisfaction', question: 'Does the page feel fast?', firstTwo: false },
];

export function firstTwoMetrics(metrics: OutcomeMetric[] = OUTCOME_METRICS): OutcomeMetric[] {
  const chosen = metrics.filter((m) => m.firstTwo);
  if (chosen.length !== 2) {
    throw new Error(
      `the rule is TWO metrics, got ${chosen.length}. A team that instruments many at once acts on none.`,
    );
  }
  return chosen;
}
