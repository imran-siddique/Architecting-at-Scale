/**
 * Which work belongs on the request path, and what a synchronous chain actually costs.
 *
 * ShopFlow's checkout at Chapter 8: a 2.1s synchronous critical path, a 4.7s carrier API call
 * inside the checkout thread, and confirmation emails taking 8 to 12 seconds while the user watches
 * a processing screen. None of those three outcomes is something the user needs before their next
 * action, which is the entire test the chapter applies.
 */

export type Blocking = 'user-blocking' | 'user-independent';

export interface Step {
  name: string;
  /**
   * True when the user cannot proceed without the outcome. Authorization, authentication,
   * validation, an instant fraud decision, or any confirmation they are waiting on.
   */
  outcomeRequiredBeforeNextAction: boolean;
  p99Ms: number;
  /** Availability of this dependency, 0..1. */
  availability: number;
}

/**
 * The Critical Path Separation Rule: classify every step, and move every user-independent one to
 * an async path.
 *
 * The Synchronous-When-Blocking Rule is the counterweight and the reason this is a classification
 * rather than a blanket instruction. Making a blocking operation async does not remove its latency,
 * it relocates it to somewhere the user cannot see it happening, which is worse: the user now waits
 * without feedback, and the failure surfaces after they have moved on.
 */
export function classify(step: Step): Blocking {
  return step.outcomeRequiredBeforeNextAction ? 'user-blocking' : 'user-independent';
}

export interface PathAnalysis {
  /** Steps that must stay synchronous. */
  blocking: string[];
  /** Steps that belong on an event path. */
  movable: string[];
  syncP99Ms: number;
  /** p99 after moving user-independent work off the request path. */
  optimizedP99Ms: number;
  /** Availability of the synchronous chain: the PRODUCT of its dependencies. */
  chainAvailability: number;
  optimizedAvailability: number;
}

/**
 * A note on the latency arithmetic.
 *
 * Summing per-step p99s does not give the chain's p99: that would require every step to hit its
 * own 99th percentile on the same request, which is far less likely than 1%. The sum is a
 * worst-case bound rather than a percentile, and it is used here on purpose because it is the
 * number that bounds the user's experience and the number a capacity plan should hold.
 *
 * Availability is different. It genuinely multiplies, because the chain needs every dependency up
 * at once, and that is why removing steps from the chain improves reliability rather than only
 * speed.
 */
export function analyzePath(steps: Step[]): PathAnalysis {
  const blocking = steps.filter((s) => classify(s) === 'user-blocking');
  const movable = steps.filter((s) => classify(s) === 'user-independent');

  const product = (xs: Step[]) => xs.reduce((acc, s) => acc * s.availability, 1);
  const worstCase = (xs: Step[]) => xs.reduce((acc, s) => acc + s.p99Ms, 0);

  return {
    blocking: blocking.map((s) => s.name),
    movable: movable.map((s) => s.name),
    syncP99Ms: worstCase(steps),
    optimizedP99Ms: worstCase(blocking),
    chainAvailability: product(steps),
    optimizedAvailability: product(blocking),
  };
}

/** ShopFlow's checkout as it stands at the start of Chapter 8. */
export const CHECKOUT_STEPS: Step[] = [
  { name: 'validate-cart', outcomeRequiredBeforeNextAction: true, p99Ms: 40, availability: 0.9999 },
  { name: 'reserve-inventory', outcomeRequiredBeforeNextAction: true, p99Ms: 120, availability: 0.999 },
  { name: 'authorize-payment', outcomeRequiredBeforeNextAction: true, p99Ms: 340, availability: 0.998 },
  // Everything below is work the user does not need before seeing their confirmation.
  { name: 'schedule-shipment', outcomeRequiredBeforeNextAction: false, p99Ms: 700, availability: 0.995 },
  { name: 'notify-carrier', outcomeRequiredBeforeNextAction: false, p99Ms: 470, availability: 0.99 },
  { name: 'send-confirmation-email', outcomeRequiredBeforeNextAction: false, p99Ms: 300, availability: 0.995 },
  { name: 'update-analytics', outcomeRequiredBeforeNextAction: false, p99Ms: 130, availability: 0.99 },
];

/* ------------------------------------------------------------------------------------------- */

/**
 * The Broker Fit Rule, and the Kafka Default anti-pattern.
 *
 * "If the workload does not require message replay, sustained throughput above 10,000 messages per
 * second, or strict per-partition ordering semantics, Kafka is not the correct starting broker."
 *
 * The anti-pattern is choosing Kafka because someone on the team already knows it. That is a real
 * reason to prefer a tool and a bad reason to accept its operational surface, and the distinction
 * is worth making explicit rather than implied.
 */
export interface WorkloadProfile {
  sustainedMessagesPerSecond: number;
  needsReplay: boolean;
  needsStrictPerPartitionOrdering: boolean;
  needsImmutableAuditLog: boolean;
}

export interface BrokerRecommendation {
  broker: 'managed-amqp' | 'kafka';
  reasons: string[];
  /** The measurable signals that would justify migrating later. */
  migrationTriggers: string[];
}

export const KAFKA_THROUGHPUT_THRESHOLD = 10_000;

export function recommendBroker(w: WorkloadProfile): BrokerRecommendation {
  const kafkaReasons: string[] = [];
  if (w.sustainedMessagesPerSecond > KAFKA_THROUGHPUT_THRESHOLD) {
    kafkaReasons.push(`sustained throughput ${w.sustainedMessagesPerSecond}/s exceeds ${KAFKA_THROUGHPUT_THRESHOLD}/s`);
  }
  if (w.needsReplay) kafkaReasons.push('message replay is a requirement');
  if (w.needsStrictPerPartitionOrdering) kafkaReasons.push('strict per-partition ordering is a requirement');
  if (w.needsImmutableAuditLog) kafkaReasons.push('an immutable audit log is a requirement');

  if (kafkaReasons.length > 0) {
    return { broker: 'kafka', reasons: kafkaReasons, migrationTriggers: [] };
  }

  return {
    broker: 'managed-amqp',
    reasons: [
      'no replay requirement',
      `throughput below ${KAFKA_THROUGHPUT_THRESHOLD}/s`,
      'no strict per-partition ordering requirement',
      'lowest operational overhead that satisfies the delivery guarantee',
    ],
    // Named and measurable, so the migration is triggered by a signal rather than by enthusiasm.
    migrationTriggers: [
      `sustained throughput above ${KAFKA_THROUGHPUT_THRESHOLD} msg/s`,
      'a confirmed need for message replay',
      'a confirmed need for an immutable audit log',
    ],
  };
}

/**
 * The Broker Migration Rule: producers and consumers must be broker-agnostic from day one, so the
 * payload format, topic naming and consumer interface must not encode Kafka primitives.
 *
 * Cheap to check and the difference between a configuration change and a rewrite.
 */
const KAFKA_PRIMITIVES = ['partitionkey', 'partition', 'consumergroup', 'offset', 'topicpartition'];

export function findBrokerCoupling(consumerInterface: Record<string, unknown>): string[] {
  return Object.keys(consumerInterface).filter((k) =>
    KAFKA_PRIMITIVES.includes(k.toLowerCase().replace(/[_-]/g, '')),
  );
}
