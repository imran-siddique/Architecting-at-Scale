import { describe, expect, it } from 'vitest';
import {
  LOGICAL_BUCKETS,
  ShardRegistry,
  addNode,
  bucketFor,
  evenRanges,
  rowsMovedByRebalance,
  rowsMovedByRehash,
  shouldShard,
} from '../src/sharding.js';
import {
  DAL_RESPONSIBILITIES,
  SHOPFLOW_READS,
  assertNoBusinessLogicInDal,
  routeRead,
} from '../src/routing.js';
import {
  ORDERS_INDEXES,
  analyzeAmplification,
  assertAuditIsSafe,
  isStructural,
} from '../src/indexes.js';
import {
  CDC_FRESHNESS_CEILING_MS,
  assessRpo,
  canServeFromSearchIndex,
  rpoStatement,
  type ReplicationTopology,
} from '../src/replication.js';

/** 20,000 customers, deterministic ids, so every fraction below is reproducible. */
const CUSTOMERS = Array.from({ length: 20_000 }, (_, i) => `cust-${i}`);

describe('the rehashing defect the reviewer caught', () => {
  it('CLAIM: hash % shardCount remaps nearly EVERY row when a node is added', () => {
    // This was a real design defect rather than a gap in the explanation. Adding one node to four
    // moves about 4 rows in 5, which makes capacity a full data migration.
    const moved = rowsMovedByRehash(CUSTOMERS, 4, 5);
    expect(moved).toBeGreaterThan(0.75);
  });

  it('the damage gets worse, not better, as the fleet grows', () => {
    // Going from 8 to 9 keeps roughly 1/9 in place. There is no fleet size at which this becomes
    // an acceptable operation.
    expect(rowsMovedByRehash(CUSTOMERS, 8, 9)).toBeGreaterThan(0.85);
    expect(rowsMovedByRehash(CUSTOMERS, 16, 17)).toBeGreaterThan(0.9);
  });

  it('CLAIM: adding a node moves only the buckets handed to it, about 1/5 of rows', () => {
    const beforeRanges = evenRanges(['n1', 'n2', 'n3', 'n4']);
    const before = new ShardRegistry(beforeRanges);
    const after = before.rebalance(addNode(beforeRanges, 'n5'));

    const moved = rowsMovedByRebalance(CUSTOMERS, before, after);
    const rehashed = rowsMovedByRehash(CUSTOMERS, 4, 5);

    // The theoretical minimum for a fifth node is 1/5 of the data. Rebalancing is a data
    // movement you schedule; rehashing is an outage you survive.
    expect(moved).toBeGreaterThan(0.15);
    expect(moved).toBeLessThan(0.25);
    expect(moved).toBeLessThan(rehashed / 3);
  });

  it('a naive rebalance that recomputes ranges from scratch moves 2.5x more than it needs to', () => {
    // Worth keeping as a warning, because an earlier version of addNode did exactly this and a
    // test caught it. Measured on 20,000 customers going from four nodes to five:
    //
    //   rehash on % shardCount ...... 80.2% of rows move
    //   recomputed even ranges ...... 51.0%
    //   minimal addNode ............. 20.5%   (theoretical floor for a fifth node is 20%)
    //
    // The naive version keeps the buckets stable and reassigns their owners anyway, which throws
    // away most of what the registry is for.
    const before = new ShardRegistry(evenRanges(['n1', 'n2', 'n3', 'n4']));
    const naive = before.rebalance(evenRanges(['n1', 'n2', 'n3', 'n4', 'n5']));
    const minimal = before.rebalance(addNode(evenRanges(['n1', 'n2', 'n3', 'n4']), 'n5'));

    const naiveMoved = rowsMovedByRebalance(CUSTOMERS, before, naive);
    const minimalMoved = rowsMovedByRebalance(CUSTOMERS, before, minimal);

    expect(naiveMoved).toBeCloseTo(0.51, 2);
    expect(minimalMoved).toBeCloseTo(0.205, 2);
    expect(naiveMoved / minimalMoved).toBeGreaterThan(2);
  });

  it('addNode lands within a whisker of the theoretical minimum', () => {
    // A fifth node must own a fifth of the data, so 20% is the floor. Anything close to it means
    // the rebalance is not moving buckets it did not have to.
    const base = evenRanges(['n1', 'n2', 'n3', 'n4']);
    const before = new ShardRegistry(base);
    const after = before.rebalance(addNode(base, 'n5'));
    expect(rowsMovedByRebalance(CUSTOMERS, before, after)).toBeLessThan(0.21);
  });

  it('CLAIM: a customer bucket NEVER changes, which is the property the whole rule rests on', () => {
    const b = bucketFor('cust-4242');
    expect(bucketFor('cust-4242')).toBe(b);
    // Adding nodes changes which node owns the bucket, never which bucket the customer is in.
    const before = new ShardRegistry(evenRanges(['n1', 'n2']));
    const after = before.rebalance(evenRanges(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']));
    expect(bucketFor('cust-4242')).toBe(b);
    expect(before.nodeForBucket(b)).not.toBe(undefined);
    expect(after.nodeForBucket(b)).not.toBe(undefined);
  });

  it('the bucket count is fixed at design time and is not the node count', () => {
    expect(LOGICAL_BUCKETS).toBe(1024);
    const registry = new ShardRegistry(evenRanges(['n1', 'n2', 'n3']));
    expect(registry.nodes).toHaveLength(3);   // 3 nodes
    // ...serving 1024 buckets, which is the decoupling that makes rebalancing cheap.
  });

  it('spreads customers roughly evenly across nodes', () => {
    const r = new ShardRegistry(evenRanges(['n1', 'n2', 'n3', 'n4']));
    const counts = new Map<string, number>();
    for (const c of CUSTOMERS) counts.set(r.nodeFor(c), (counts.get(r.nodeFor(c)) ?? 0) + 1);
    const values = [...counts.values()];
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.15);
  });

  it('refuses a registry with a gap or an overlap, because both are silent', () => {
    // A gap is an unreachable customer. An overlap is two nodes both believing they own a row.
    expect(() => new ShardRegistry([{ from: 0, to: 500, node: 'n1' }])).toThrow(/maps to no node/);
    expect(() => new ShardRegistry([
      { from: 0, to: 600, node: 'n1' },
      { from: 500, to: 1023, node: 'n2' },
    ])).toThrow(/claimed by both/);
  });

  it('partitioning is exhausted before sharding', () => {
    // Partitioning is a change inside one database. Sharding changes the shape of the system.
    expect(shouldShard({
      tableSizeGb: 400, partitioned: false, hasNaturalPartitionKey: true, writeIopsUtilization: 0.85,
    })).toMatchObject({ shard: false });

    expect(shouldShard({
      tableSizeGb: 400, partitioned: true, hasNaturalPartitionKey: true, writeIopsUtilization: 0.85,
    })).toMatchObject({ shard: true });
  });
});

describe('primary versus replica: whether you wrote it, not how important it feels', () => {
  const replica = { lagCeilingMs: 45_000 };   // ShopFlow: 8 to 45 seconds

  it('CLAIM: read-your-writes forces the primary regardless of importance', () => {
    for (const name of ['checkout-confirmation', 'inventory-reservation-check', 'payment-verification']) {
      const intent = SHOPFLOW_READS.find((r) => r.name === name)!;
      expect(routeRead(intent, replica).route).toBe('primary');
    }
  });

  it('CLAIM: order history is IMPORTANT and still belongs on the replica', () => {
    // The axis is not importance. Nobody reading their order history is reading a write they just
    // made, so 45 seconds of lag is invisible to them.
    const history = SHOPFLOW_READS.find((r) => r.name === 'order-history')!;
    expect(routeRead(history, replica)).toMatchObject({ route: 'replica' });
  });

  it('a tolerance below the lag ceiling forces the primary even without read-your-writes', () => {
    const tight = { name: 'near-real-time-widget', readsOwnRecentWrite: false, toleratedStalenessMs: 5_000 };
    const d = routeRead(tight, replica);
    expect(d.route).toBe('primary');
    expect(d.reason).toMatch(/below the replica lag ceiling/);
  });

  it('the DAL owns cross-cutting concerns and not business logic', () => {
    expect(() => assertNoBusinessLogicInDal(DAL_RESPONSIBILITIES)).not.toThrow();

    // The moment the DAL knows what an order means, every service inherits its version of one.
    const leaky = [...DAL_RESPONSIBILITIES.map((r) =>
      r.name === 'order total calculation' ? { ...r, belongsInDal: true } : r)];
    expect(() => assertNoBusinessLogicInDal(leaky)).toThrow(/business logic in the DAL/);
  });
});

describe('index write amplification', () => {
  const report = analyzeAmplification(ORDERS_INDEXES);

  it('reproduces the chapter telemetry: eleven indexes, twelve writes per insert', () => {
    expect(report.indexCount).toBe(11);
    expect(report.writesPerInsert).toBe(12);
    expect(report.indexShareOfWrites).toBeGreaterThan(0.9);
  });

  it('CLAIM: three of the eleven are STRUCTURAL and never audit candidates', () => {
    // The correction that mattered during review. An audit reporting "11 indexes, consider
    // removing some" is giving dangerous advice, because three of them enforce correctness.
    expect(report.structuralCount).toBe(3);
    expect(report.auditableCount).toBe(8);
    expect(ORDERS_INDEXES.filter(isStructural).map((ix) => ix.name).sort())
      .toEqual(['pk_orders', 'uq_orders_idempotency', 'uq_orders_number']);
  });

  it('CLAIM: refuses an audit that proposes dropping a structural index', () => {
    expect(() => assertAuditIsSafe(['ix_orders_channel', 'ix_orders_promo'], ORDERS_INDEXES)).not.toThrow();
    // uq_orders_idempotency is the constraint Chapter 8 relies on to stop double charges.
    expect(() => assertAuditIsSafe(['uq_orders_idempotency'], ORDERS_INDEXES))
      .toThrow(/reintroduces the Chapter 8 double charge/);
    expect(() => assertAuditIsSafe(['pk_orders'], ORDERS_INDEXES)).toThrow(/structural/);
  });

  it('finds the safe wins: auditable indexes serving no reads at all', () => {
    expect(report.unused.sort()).toEqual(['ix_orders_channel', 'ix_orders_legacy_ref', 'ix_orders_promo']);
  });

  it('flags low-value indexes separately from unused ones', () => {
    // A judgement rather than a deletion: 45 reads a day may still be a report someone needs.
    expect(report.suspect.sort()).toEqual(['ix_orders_ship_country_status', 'ix_orders_updated']);
  });
});

describe('RPO, stated precisely', () => {
  const oneSyncReplica: ReplicationTopology = {
    mode: 'sync', syncReplicas: 1, asyncReplicas: 1,
    acrossFailureDomains: true, asyncLagCeilingMs: 45_000,
  };
  const quorum: ReplicationTopology = { ...oneSyncReplica, syncReplicas: 2 };

  it('CLAIM: one synchronous replica gives zero RPO for a SINGLE-node failure', () => {
    expect(assessRpo(oneSyncReplica, 'single-node')).toMatchObject({ rpoMs: 0, dataLoss: false });
  });

  it('CLAIM: the same topology still LOSES committed writes on a correlated failure', () => {
    // This is the correction. A rack, an availability zone or a bad deploy takes the primary and
    // its only synchronous replica together, and "zero RPO" gets read as "we cannot lose data".
    const pair = assessRpo(oneSyncReplica, 'correlated-pair');
    expect(pair.dataLoss).toBe(true);
    expect(pair.explanation).toMatch(/only true for a single-node failure/);
  });

  it('CLAIM: true zero RPO needs a quorum of two or more synchronous replicas', () => {
    expect(assessRpo(quorum, 'correlated-pair')).toMatchObject({ rpoMs: 0, dataLoss: false });
  });

  it('asynchronous replication loses up to the lag ceiling in any failover', () => {
    const async: ReplicationTopology = { ...oneSyncReplica, mode: 'async', syncReplicas: 0 };
    expect(assessRpo(async, 'single-node')).toMatchObject({ rpoMs: 45_000, dataLoss: true });
  });

  it('the honest statement names both scenarios instead of saying "zero RPO"', () => {
    expect(rpoStatement(oneSyncReplica)).toBe(
      'RPO: 0ms for a single-node failure; 45000ms for a correlated primary-plus-replica failure.',
    );
    expect(rpoStatement(quorum)).toMatch(/0ms for a correlated/);
  });

  it('a whole-region loss is a business decision, not a configuration', () => {
    expect(assessRpo(quorum, 'whole-region').explanation).toMatch(/business decision/);
  });
});

describe('search index freshness is a contract', () => {
  it('serves browse and reporting, which tolerate the CDC lag', () => {
    expect(canServeFromSearchIndex({ name: 'catalog-browse', toleratedStalenessMs: 300_000 }).ok).toBe(true);
  });

  it('CLAIM: real-time stock must NOT be served from the search index', () => {
    // The same conclusion Chapter 9 reached about caching it. The cost of being wrong is a
    // customer buying something that does not exist, and no lag is short enough for that.
    const stock = canServeFromSearchIndex({ name: 'real-time-stock', toleratedStalenessMs: 0 });
    expect(stock.ok).toBe(false);
    expect(stock.reason).toMatch(/Chapter 9/);
  });

  it('the freshness ceiling is the contract the index publishes', () => {
    expect(CDC_FRESHNESS_CEILING_MS).toBe(10_000);
    expect(canServeFromSearchIndex({ name: 'edge', toleratedStalenessMs: 9_999 }).ok).toBe(false);
    expect(canServeFromSearchIndex({ name: 'edge', toleratedStalenessMs: 10_000 }).ok).toBe(true);
  });
});
