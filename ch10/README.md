# Chapter 10: Scaling Data and Databases

**Storage, Queries, and Beyond**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/data/`](../app/packages/data/) | Logical shard buckets, read routing, index amplification, RPO |

## Where ShopFlow is at this point

Chapter 9's caching absorbed the read amplification. The pressure moved to the other side of the
ledger.

| Metric | Stage 10 |
|--------|----------|
| Write p99 (Orders) | 24ms, crept from 8ms |
| Write IOPS | 71% of provisioned |
| Index write amplification | **11 indexes per insert**, 40% of write IOPS |
| Product search p99 | **1.8s**, a `LIKE` scan |
| Read replica lag | 8 to 45 seconds |

## The rehashing defect, measured

This is the most valuable thing in the chapter and it has history. Chapter 10 originally specified
`hash(customer_id) % shardCount`, and the technical reviewer asked what happens when the shard count
changes. It was a **real design defect**, not a gap in the explanation.

Measured on 20,000 customers going from four nodes to five:

| Routing | Rows that move |
|---|---|
| `hash % shardCount` | **80.2%** |
| Registry rebalanced by recomputing even ranges | 51.0% |
| Registry rebalanced minimally (`addNode`) | **20.5%** |

The floor for a fifth node is 20%, since it must own a fifth of the data. So `addNode` is within
half a percentage point of optimal, and rehashing moves four times more data than necessary. That is
the difference between a rebalance you schedule and a migration you survive.

The property everything rests on: **a customer's bucket never changes.** Adding nodes changes which
node owns a bucket, never which bucket a customer is in.

### The middle row is there because I got it wrong

My first `addNode` rebalanced by recomputing contiguous even ranges from scratch, which moves 51% of
rows. A test caught it. That version keeps the buckets stable and reassigns their owners anyway,
which throws away most of what the registry is for, so it is kept as a named test rather than
quietly deleted. It is an easy mistake to make and an invisible one in production until the first
rebalance takes a weekend.

## Primary versus replica: the wrong axis and the right one

The split is usually explained by importance, which produces the wrong answer. The chapter's test is
sharper:

> not how important the data feels, but whether the reader is the one who just wrote it

**Order history is important and belongs on the replica.** Nobody reading their order history is
reading a write they just made, so 45 seconds of lag is invisible to them. Inventory availability
during checkout is not more important in the abstract, but the customer reading it is the one who
just reserved it, so a stale answer is a *wrong* answer.

A tolerance below the lag ceiling forces the primary too, even without read-your-writes, because a
replica cannot satisfy a contract tighter than its own lag.

## Three of the eleven indexes are not audit candidates

The correction that mattered. The primary key and two unique constraints enforce identity and
uniqueness, not query performance. An audit reporting *"11 indexes, consider removing some"* is
giving dangerous advice.

`assertAuditIsSafe` refuses to drop them, and the error message names the consequence:
**dropping `uq_orders_idempotency` reintroduces the Chapter 8 double charge.** That constraint is the
authoritative dedup record from the previous chapter, and it looks like an ordinary index in a schema
dump.

The eight auditable indexes split into three serving zero reads (safe wins) and two serving under a
hundred a day (a judgement, not a deletion, since it may be a report someone needs).

## "Zero RPO" is only true for one failure

The other review correction, and worth encoding because the imprecise version is what most teams
believe:

| Topology | Single-node failure | Correlated primary-plus-replica |
|---|---|---|
| One synchronous replica | **0ms** | **45s of committed writes lost** |
| Quorum of two, across domains | 0ms | **0ms** |

Synchronous replication to *one* replica gives zero RPO for a single-node failure and nothing more.
A rack, an availability zone, or a bad deploy takes the primary and its replica together, and "zero
RPO" in a design document gets read as "we cannot lose data". `rpoStatement()` exists to produce the
honest two-clause version instead.

## Search freshness is a contract

Elasticsearch is fed by CDC at 2 to 10 seconds. That lag is published, so anything needing fresher
must not be answered from the index. Real-time stock is the deciding case, and it reaches **the same
conclusion Chapter 9 reached about caching it**: the cost of being wrong is a customer buying
something that does not exist, and no lag is short enough for that.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

Write p99 is down to 11ms, search to 95ms, and availability reaches 99.9%. The remaining problem is
one no infrastructure metric can see: a persistent 0.3% silent-failure floor, where every dashboard
is green and some customers are still not getting their orders. That is Chapter 11.
