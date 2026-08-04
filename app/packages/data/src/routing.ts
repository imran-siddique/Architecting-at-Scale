/**
 * Primary versus replica routing, and the test that actually decides it.
 *
 * Chapter 10's read-replica split is usually explained by importance, which is the wrong axis and
 * produces the wrong answer. The generalizing test from the chapter is sharper:
 *
 *   not how important the data feels, but whether the reader is the one who just wrote it.
 *
 * Order history is important and belongs on the replica. Inventory availability during checkout is
 * not more "important" in any abstract sense, but the customer reading it is the one who just
 * reserved it, so a stale answer is a wrong answer.
 *
 * ShopFlow's replica lag is 8 to 45 seconds, so this is not a theoretical concern. Any read routed
 * to a replica must tolerate being that far behind.
 */

export type Route = 'primary' | 'replica';

export interface ReadIntent {
  name: string;
  /**
   * True when the caller is reading something they, or the customer they are acting for, wrote
   * within the replica lag window. This is the deciding property.
   */
  readsOwnRecentWrite: boolean;
  /**
   * Maximum staleness the caller can tolerate, in milliseconds. A value below the replica lag
   * ceiling forces the primary regardless of the flag above.
   */
  toleratedStalenessMs: number;
}

export interface ReplicaProfile {
  /** Observed lag ceiling. ShopFlow: 8 to 45 seconds, so 45_000 here. */
  lagCeilingMs: number;
}

export interface RoutingDecision {
  route: Route;
  reason: string;
}

export function routeRead(intent: ReadIntent, replica: ReplicaProfile): RoutingDecision {
  if (intent.readsOwnRecentWrite) {
    return {
      route: 'primary',
      reason: 'read-your-writes: the caller is reading what it just wrote, so a stale answer is a wrong answer',
    };
  }
  if (intent.toleratedStalenessMs < replica.lagCeilingMs) {
    return {
      route: 'primary',
      reason:
        `tolerated staleness ${intent.toleratedStalenessMs}ms is below the replica lag ceiling ` +
        `${replica.lagCeilingMs}ms, so the replica cannot satisfy the contract`,
    };
  }
  return { route: 'replica', reason: 'tolerates replica lag and does not read its own recent write' };
}

/** ShopFlow's read intents at the Chapter 10 state. */
export const SHOPFLOW_READS: ReadIntent[] = [
  // Primary: the caller just wrote this.
  { name: 'checkout-confirmation', readsOwnRecentWrite: true, toleratedStalenessMs: 0 },
  { name: 'inventory-reservation-check', readsOwnRecentWrite: true, toleratedStalenessMs: 0 },
  { name: 'payment-verification', readsOwnRecentWrite: true, toleratedStalenessMs: 0 },
  // Replica: important, but nobody is reading their own recent write.
  { name: 'order-history', readsOwnRecentWrite: false, toleratedStalenessMs: 60_000 },
  { name: 'reporting-dashboard', readsOwnRecentWrite: false, toleratedStalenessMs: 3_600_000 },
  { name: 'catalog-browse', readsOwnRecentWrite: false, toleratedStalenessMs: 300_000 },
];

/* ------------------------------------------------------------------------------------------- */

/**
 * The DAL Boundary.
 *
 * Every service reaches its data through a Data Access Layer that owns pooling, bounded retries,
 * per-query timeouts, per-store circuit breakers, and shard-tagged telemetry. The rule the boundary
 * exists to protect is that business logic does not leak into it, because the moment the DAL knows
 * what an order is, every service needs the DAL's version of an order.
 */
export interface DalResponsibility {
  name: string;
  belongsInDal: boolean;
  why: string;
}

export const DAL_RESPONSIBILITIES: DalResponsibility[] = [
  { name: 'connection pooling', belongsInDal: true, why: 'One pool per store, sized once, observable in one place.' },
  { name: 'bounded retries', belongsInDal: true, why: 'Retry policy is a property of the store, not of each caller.' },
  { name: 'per-query timeouts', belongsInDal: true, why: 'A query with no timeout holds a connection indefinitely.' },
  { name: 'per-store circuit breakers', belongsInDal: true, why: 'One degraded store must not exhaust callers of the others.' },
  { name: 'shard-tagged telemetry', belongsInDal: true, why: 'A slow shard is invisible in an aggregate metric.' },
  { name: 'primary/replica routing', belongsInDal: true, why: 'The routing rule is uniform; per-caller copies drift.' },
  // The line.
  { name: 'order total calculation', belongsInDal: false, why: 'Business logic. The DAL must not know what an order means.' },
  { name: 'discount eligibility', belongsInDal: false, why: 'Business logic, and it changes on a different cadence than storage.' },
  { name: 'inventory reservation rules', belongsInDal: false, why: 'Domain invariant owned by the Inventory service.' },
];

export function assertNoBusinessLogicInDal(responsibilities: DalResponsibility[]): void {
  const leaked = responsibilities.filter((r) => r.belongsInDal && /calculation|eligibility|rules|policy/i.test(r.name));
  if (leaked.length > 0) {
    throw new Error(
      `business logic in the DAL: ${leaked.map((l) => l.name).join(', ')}. ` +
        `Once the DAL knows what an order means, every service inherits its version of an order.`,
    );
  }
}
