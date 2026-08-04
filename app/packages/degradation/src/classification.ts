/**
 * P0/P1/P2 classification, the correctness floor, and the P0P0.
 *
 * ShopFlow enters Chapter 12 able to see its failures and with no defined behaviour for them: every
 * service has a happy-path SLO and none has a documented degraded path. Grading capabilities is the
 * first move, and the chapter adds two ideas that make the grading honest.
 *
 * The first is that some capabilities are NOT graded at all. Degrading them does not produce a
 * reduced service, it produces an incorrect one, and a fast wrong answer is not a degraded mode; it
 * is a defect with better latency.
 *
 * The second is that every P0 gets asked for its P0P0: the one thing inside it that must survive
 * even when the P0 itself is degrading. For checkout, the P0 is completing an order and the P0P0 is
 * capturing the payment intent, because a customer who has been charged and has no order is a worse
 * outcome than a customer who could not order at all.
 */

export type Priority = 'P0' | 'P1' | 'P2';

/** Capabilities that are never graded. Degrading them yields an incorrect service. */
export const CORRECTNESS_FLOOR = [
  'authentication',
  'authorization',
  'payment-integrity',
  'audit-logging',
  'data-integrity-constraints',
  'regulatory-and-privacy-controls',
] as const;

export type FloorCapability = (typeof CORRECTNESS_FLOOR)[number];

export function isCorrectnessFloor(capability: string): boolean {
  return (CORRECTNESS_FLOOR as readonly string[]).includes(capability);
}

export interface Capability {
  name: string;
  /** Revenue or trust lost per hour of full unavailability. Drives the grade. */
  hourlyImpactUsd: number;
  /** True when a reduced version of this capability is still correct. */
  hasMeaningfulDegradedMode: boolean;
  /** What the degraded mode is. Required for anything graded P0 or P1. */
  degradedBehaviour?: string;
  /** For a P0: the one thing inside it that must survive the P0 degrading. */
  p0p0?: string;
}

export type Grade =
  | { priority: Priority; capability: string; degradedBehaviour: string; p0p0?: string }
  | { priority: 'ungraded'; capability: string; reason: string };

/**
 * Grade a capability, or refuse to.
 *
 * The refusal is the interesting path. A correctness-floor capability that arrives with a proposed
 * degraded mode is a design error, and returning `ungraded` with a reason is more useful than
 * silently assigning it P0.
 */
export function grade(c: Capability): Grade {
  if (isCorrectnessFloor(c.name)) {
    return {
      priority: 'ungraded',
      capability: c.name,
      reason:
        'on the correctness floor: degrading it yields an incorrect service rather than a reduced one. ' +
        'A fast wrong answer is not a degraded mode, it is a defect with better latency.',
    };
  }

  const priority: Priority = c.hourlyImpactUsd >= 10_000 ? 'P0' : c.hourlyImpactUsd >= 1_000 ? 'P1' : 'P2';

  if ((priority === 'P0' || priority === 'P1') && !c.degradedBehaviour) {
    throw new Error(
      `${c.name} is graded ${priority} with no documented degraded behaviour. ` +
        `Grading without a degraded path is how a system ends up with a priority and no plan.`,
    );
  }
  if (priority === 'P0' && !c.p0p0) {
    throw new Error(
      `${c.name} is P0 with no P0P0 declared. Every P0 must name the one thing that survives ` +
        `the P0 itself degrading.`,
    );
  }

  return {
    priority,
    capability: c.name,
    degradedBehaviour: c.degradedBehaviour!,
    ...(c.p0p0 ? { p0p0: c.p0p0 } : {}),
  };
}

export const SHOPFLOW_CAPABILITIES: Capability[] = [
  {
    name: 'complete-checkout',
    hourlyImpactUsd: 42_000,
    hasMeaningfulDegradedMode: true,
    degradedBehaviour: 'accept the order with cached pricing and queue fulfilment',
    p0p0: 'capture the payment intent, so a charged customer always has an order',
  },
  {
    name: 'browse-catalog',
    hourlyImpactUsd: 12_000,
    hasMeaningfulDegradedMode: true,
    degradedBehaviour: 'serve the last-known catalog from the edge, no personalization',
    p0p0: 'render a product page, so inbound links and ads do not 404',
  },
  {
    name: 'product-search',
    hourlyImpactUsd: 3_400,
    hasMeaningfulDegradedMode: true,
    degradedBehaviour: 'fall back to category browse with a notice',
  },
  {
    name: 'recommendations',
    hourlyImpactUsd: 400,
    hasMeaningfulDegradedMode: true,
    degradedBehaviour: 'hide the module entirely',
  },
  // Never graded.
  { name: 'payment-integrity', hourlyImpactUsd: 42_000, hasMeaningfulDegradedMode: false },
  { name: 'authorization', hourlyImpactUsd: 42_000, hasMeaningfulDegradedMode: false },
  { name: 'audit-logging', hourlyImpactUsd: 8_000, hasMeaningfulDegradedMode: false },
];

/**
 * Every P0 flow must have a documented degraded path. This is the check that turns "we have SLOs"
 * into "we have a plan", and it is the gap ShopFlow enters the chapter with.
 */
export function coverageReport(capabilities: Capability[]): {
  graded: Grade[];
  ungraded: Grade[];
  p0WithoutDegradedPath: string[];
  p0WithoutP0p0: string[];
} {
  const graded: Grade[] = [];
  const ungraded: Grade[] = [];
  const missingPath: string[] = [];
  const missingP0p0: string[] = [];

  for (const c of capabilities) {
    if (isCorrectnessFloor(c.name)) {
      ungraded.push(grade(c));
      continue;
    }
    try {
      graded.push(grade(c));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('no P0P0')) missingP0p0.push(c.name);
      else missingPath.push(c.name);
    }
  }

  return { graded, ungraded, p0WithoutDegradedPath: missingPath, p0WithoutP0p0: missingP0p0 };
}
