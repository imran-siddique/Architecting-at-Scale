/**
 * Logical shards, and the rehashing defect they prevent.
 *
 * This one has history. Chapter 10 originally specified `hash(customer_id) % shardCount`, and the
 * technical reviewer asked what happens when the shard count changes. The answer is that nearly
 * every row moves, which makes adding capacity a full data migration rather than a routine
 * operation. It was a real design defect rather than a gap in the explanation, and the fix is The
 * Logical Shard Rule: a fixed bucket count chosen once at design time, with a registry mapping
 * bucket ranges to physical nodes.
 *
 * `rowsMovedByRehash` and `rowsMovedByRebalance` below are the two numbers that make the
 * difference impossible to argue with.
 */

/** Chosen once, at design time, and never changed. Never the live physical node count. */
export const LOGICAL_BUCKETS = 1024;

/** FNV-1a. Deterministic across processes and languages, which matters for a routing function. */
export function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The bucket a customer belongs to. Stable for the life of the system. */
export function bucketFor(customerId: string, buckets = LOGICAL_BUCKETS): number {
  return hashKey(customerId) % buckets;
}

/**
 * The broken routing, kept only so a test can measure what it costs.
 * Do not use it. It is evidence, not an option.
 */
export function brokenShardFor(customerId: string, shardCount: number): number {
  return hashKey(customerId) % shardCount;
}

/* ------------------------------------------------------------------------------------------- */

export interface BucketRange {
  /** Inclusive. */
  from: number;
  /** Inclusive. */
  to: number;
  node: string;
}

/**
 * The shard registry: bucket ranges to physical nodes.
 *
 * Adding capacity means reassigning ranges, so the only rows that move are the ones in the
 * reassigned buckets. Nothing is rehashed, because a customer's bucket never changes.
 */
export class ShardRegistry {
  constructor(
    private ranges: BucketRange[],
    private readonly buckets = LOGICAL_BUCKETS,
  ) {
    this.assertTotalCoverage();
  }

  /** Every bucket must map to exactly one node. A gap is a silently unreachable customer. */
  private assertTotalCoverage(): void {
    const owner = new Array<string | undefined>(this.buckets);
    for (const r of this.ranges) {
      if (r.from < 0 || r.to >= this.buckets || r.from > r.to) {
        throw new RangeError(`invalid bucket range ${r.from}..${r.to}`);
      }
      for (let b = r.from; b <= r.to; b++) {
        if (owner[b] !== undefined) {
          throw new Error(`bucket ${b} is claimed by both ${owner[b]} and ${r.node}`);
        }
        owner[b] = r.node;
      }
    }
    const gap = owner.findIndex((o) => o === undefined);
    if (gap !== -1) throw new Error(`bucket ${gap} maps to no node`);
  }

  nodeFor(customerId: string): string {
    const b = bucketFor(customerId, this.buckets);
    const r = this.ranges.find((x) => b >= x.from && b <= x.to);
    if (!r) throw new Error(`no node owns bucket ${b}`);
    return r.node;
  }

  nodeForBucket(bucket: number): string {
    const r = this.ranges.find((x) => bucket >= x.from && bucket <= x.to);
    if (!r) throw new Error(`no node owns bucket ${bucket}`);
    return r.node;
  }

  /** Replace the mapping, for example when adding a node. Coverage is re-verified. */
  rebalance(ranges: BucketRange[]): ShardRegistry {
    return new ShardRegistry(ranges, this.buckets);
  }

  get nodes(): string[] {
    return [...new Set(this.ranges.map((r) => r.node))];
  }
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Fraction of rows that change node when the PHYSICAL shard count changes under modulo routing.
 *
 * For a hash spread uniformly, going from n to n+1 shards keeps roughly 1/(n+1) of rows in place,
 * so almost everything moves. That is the defect: capacity becomes a migration.
 */
export function rowsMovedByRehash(customerIds: string[], fromShards: number, toShards: number): number {
  let moved = 0;
  for (const id of customerIds) {
    if (brokenShardFor(id, fromShards) !== brokenShardFor(id, toShards)) moved++;
  }
  return moved / customerIds.length;
}

/**
 * Fraction of rows that change node when the REGISTRY is rebalanced.
 *
 * Only the reassigned buckets move, so this is the share of buckets handed to the new node and
 * nothing more. Rebalancing is a data movement you schedule rather than an outage you survive.
 */
export function rowsMovedByRebalance(
  customerIds: string[],
  before: ShardRegistry,
  after: ShardRegistry,
): number {
  let moved = 0;
  for (const id of customerIds) {
    if (before.nodeFor(id) !== after.nodeFor(id)) moved++;
  }
  return moved / customerIds.length;
}

/** Even split of the bucket space across `nodes`, for the initial layout and for rebalancing. */
export function evenRanges(nodes: string[], buckets = LOGICAL_BUCKETS): BucketRange[] {
  const per = Math.floor(buckets / nodes.length);
  return nodes.map((node, i) => ({
    from: i * per,
    to: i === nodes.length - 1 ? buckets - 1 : (i + 1) * per - 1,
    node,
  }));
}

/**
 * The Partitioning-Before-Sharding check.
 *
 * Chapter 10 is explicit that partitioning is exhausted before sharding, because partitioning is a
 * change you make inside one database and sharding is a change to the shape of the whole system.
 * Reaching for the second while the first is still available buys distributed-systems problems in
 * exchange for work you could have done locally.
 */
export interface ScalingPosture {
  tableSizeGb: number;
  partitioned: boolean;
  /** True when the workload has a natural partition key, usually time. */
  hasNaturalPartitionKey: boolean;
  writeIopsUtilization: number;
}

export function shouldShard(p: ScalingPosture): { shard: boolean; reason: string } {
  if (!p.partitioned && p.hasNaturalPartitionKey) {
    return {
      shard: false,
      reason:
        'partitioning is still available and is a change inside one database; ' +
        'sharding changes the shape of the whole system and should not be reached for first',
    };
  }
  if (p.writeIopsUtilization < 0.7) {
    return { shard: false, reason: `write IOPS at ${(p.writeIopsUtilization * 100).toFixed(0)}% does not yet justify sharding` };
  }
  return { shard: true, reason: 'partitioning exhausted and write capacity is the binding constraint' };
}

/**
 * Add a node, moving the minimum possible number of buckets.
 *
 * This is the operation the registry exists for, and getting it wrong wastes the whole design. An
 * earlier version of this file rebalanced by recomputing contiguous even ranges from scratch, which
 * reassigns almost every bucket and is barely better than rehashing. A test caught it.
 *
 * The correct move is to take a slice from each existing node until the new node holds its share,
 * and leave every other bucket exactly where it is. The new node ends up owning several
 * non-contiguous ranges, which is fine: the registry is a list, not a partition.
 */
export function addNode(
  current: BucketRange[],
  newNode: string,
  buckets = LOGICAL_BUCKETS,
): BucketRange[] {
  const existing = [...new Set(current.map((r) => r.node))];
  if (existing.includes(newNode)) throw new Error(`${newNode} is already in the registry`);

  const targetPerNode = Math.floor(buckets / (existing.length + 1));
  const kept: BucketRange[] = [];
  const taken: BucketRange[] = [];

  for (const node of existing) {
    const owned = current
      .filter((r) => r.node === node)
      .sort((a, b) => a.from - b.from);
    const count = owned.reduce((a, r) => a + (r.to - r.from + 1), 0);
    let toGiveUp = Math.max(0, count - targetPerNode);

    // Take from the tail, so the buckets that stay keep their existing ranges intact.
    for (const r of [...owned].reverse()) {
      const size = r.to - r.from + 1;
      if (toGiveUp <= 0) {
        kept.push(r);
        continue;
      }
      if (toGiveUp >= size) {
        taken.push({ ...r, node: newNode });
        toGiveUp -= size;
      } else {
        taken.push({ from: r.to - toGiveUp + 1, to: r.to, node: newNode });
        kept.push({ from: r.from, to: r.to - toGiveUp, node });
        toGiveUp = 0;
      }
    }
  }

  return [...kept, ...taken].sort((a, b) => a.from - b.from);
}
