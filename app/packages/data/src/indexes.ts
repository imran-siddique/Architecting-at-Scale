/**
 * Index write amplification, and which indexes are actually audit candidates.
 *
 * ShopFlow's Chapter 10 telemetry: eleven indexes on the Orders table, accounting for 40% of total
 * database write IOPS. Every insert writes the row once and the indexes eleven times.
 *
 * The distinction that matters, and the one that was corrected during review: **three of those
 * eleven are structural.** The primary key and two unique constraints are not indexes someone added
 * for a query, they are how the table enforces identity and uniqueness. Dropping one does not cost
 * you a slow query, it costs you duplicate orders. So they are never audit candidates, and an audit
 * that reports "11 indexes, consider removing some" is giving dangerous advice.
 */

export type IndexKind = 'primary-key' | 'unique-constraint' | 'query-index';

export interface IndexSpec {
  name: string;
  kind: IndexKind;
  columns: string[];
  /** Reads per day served by this index. Zero means nothing uses it. */
  readsPerDay: number;
  /** Relative write cost per insert. Wider and more columns cost more. */
  writeCostUnits: number;
}

/** Structural indexes enforce correctness and are never candidates for removal. */
export function isStructural(ix: IndexSpec): boolean {
  return ix.kind === 'primary-key' || ix.kind === 'unique-constraint';
}

export interface AmplificationReport {
  indexCount: number;
  structuralCount: number;
  /** Indexes that could be dropped without losing a correctness guarantee. */
  auditableCount: number;
  /** Writes per insert: the row plus one per index. */
  writesPerInsert: number;
  /** Share of write cost attributable to indexes rather than the row. */
  indexShareOfWrites: number;
  /** Auditable indexes serving no reads. The safe wins. */
  unused: string[];
  /** Auditable indexes whose write cost exceeds their read value. */
  suspect: string[];
}

export function analyzeAmplification(
  indexes: IndexSpec[],
  opts: { rowWriteCostUnits?: number; suspectReadsPerDay?: number } = {},
): AmplificationReport {
  const rowCost = opts.rowWriteCostUnits ?? 1;
  const suspectBelow = opts.suspectReadsPerDay ?? 100;

  const structural = indexes.filter(isStructural);
  const auditable = indexes.filter((ix) => !isStructural(ix));
  const indexCost = indexes.reduce((a, ix) => a + ix.writeCostUnits, 0);

  return {
    indexCount: indexes.length,
    structuralCount: structural.length,
    auditableCount: auditable.length,
    writesPerInsert: 1 + indexes.length,
    indexShareOfWrites: indexCost / (rowCost + indexCost),
    unused: auditable.filter((ix) => ix.readsPerDay === 0).map((ix) => ix.name),
    suspect: auditable
      .filter((ix) => ix.readsPerDay > 0 && ix.readsPerDay < suspectBelow)
      .map((ix) => ix.name),
  };
}

/** ShopFlow's Orders table at the Chapter 10 state: eleven indexes, three of them structural. */
export const ORDERS_INDEXES: IndexSpec[] = [
  { name: 'pk_orders', kind: 'primary-key', columns: ['id'], readsPerDay: 4_000_000, writeCostUnits: 1 },
  { name: 'uq_orders_number', kind: 'unique-constraint', columns: ['order_number'], readsPerDay: 900_000, writeCostUnits: 1 },
  { name: 'uq_orders_idempotency', kind: 'unique-constraint', columns: ['idempotency_key'], readsPerDay: 1_200_000, writeCostUnits: 1 },
  { name: 'ix_orders_customer', kind: 'query-index', columns: ['customer_id'], readsPerDay: 2_100_000, writeCostUnits: 1 },
  { name: 'ix_orders_status_created', kind: 'query-index', columns: ['status', 'created_at'], readsPerDay: 640_000, writeCostUnits: 2 },
  { name: 'ix_orders_created', kind: 'query-index', columns: ['created_at'], readsPerDay: 310_000, writeCostUnits: 1 },
  { name: 'ix_orders_updated', kind: 'query-index', columns: ['updated_at'], readsPerDay: 12, writeCostUnits: 1 },
  { name: 'ix_orders_channel', kind: 'query-index', columns: ['channel'], readsPerDay: 0, writeCostUnits: 1 },
  { name: 'ix_orders_promo', kind: 'query-index', columns: ['promo_code'], readsPerDay: 0, writeCostUnits: 1 },
  { name: 'ix_orders_legacy_ref', kind: 'query-index', columns: ['legacy_ref'], readsPerDay: 0, writeCostUnits: 1 },
  { name: 'ix_orders_ship_country_status', kind: 'query-index', columns: ['ship_country', 'status'], readsPerDay: 45, writeCostUnits: 2 },
];

/**
 * Guard against the dangerous audit.
 *
 * An audit that proposes dropping a primary key or a unique constraint is not aggressive, it is
 * wrong: those enforce identity and uniqueness, and in ShopFlow's case `uq_orders_idempotency` is
 * the very constraint Chapter 8 relies on to prevent double charges.
 */
export function assertAuditIsSafe(proposed: string[], indexes: IndexSpec[]): void {
  const byName = new Map(indexes.map((ix) => [ix.name, ix]));
  const structural = proposed.filter((n) => {
    const ix = byName.get(n);
    return ix !== undefined && isStructural(ix);
  });
  if (structural.length > 0) {
    throw new Error(
      `refusing to drop structural indexes: ${structural.join(', ')}. ` +
        `These enforce identity and uniqueness, not query performance. ` +
        `Dropping uq_orders_idempotency reintroduces the Chapter 8 double charge.`,
    );
  }
}
