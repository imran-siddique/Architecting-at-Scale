# Chapter 10 — Architect's Prompts

**Scaling Data and Databases – Storage, Queries, and Beyond**

The Architect's Prompts from Chapter 10, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [10.1 The SQL vs. NoSQL Decision Audit](#prompt-10-1-the-sql-vs-nosql-decision-audit) | Use this prompt before any database migration decision, whether from relational to NoSQL or… |
| [10.2 The Sharding Strategy Audit](#prompt-10-2-the-sharding-strategy-audit) | Use this prompt when designing the sharding strategy for a table that has exceeded the… |
| [10.3 The Index Audit](#prompt-10-3-the-index-audit) | Use this prompt when write performance is degrading on a high-write table, when write IOPS… |
| [10.4 The Data Access Layer Design Review](#prompt-10-4-the-data-access-layer-design-review) | Use this prompt when designing the DAL for a sharded or multi-store data architecture, or… |
| [10.5 The Search Engine Migration Audit](#prompt-10-5-the-search-engine-migration-audit) | Use this prompt when evaluating whether to migrate product search from a database LIKE query… |

---

## Prompt 10.1 — The SQL vs. NoSQL Decision Audit

**When to use this:** Use this prompt before any database migration decision, whether from relational to NoSQL or the reverse. The output is a justified technology choice grounded in the actual access patterns, not in performance intuition or technology preference.

```text
Act as a Principal Data Architect. I am evaluating whether to migrate
[Table/Service Name] from [current store] to [proposed store].

Current state:
- Schema: [table structure or document shape]
- Primary access patterns: [list of read and write queries with frequency]
- Relational requirements: [joins, transactions, foreign keys, constraints]
- Current performance bottleneck: [IOPS / latency / query plan / lock contention]
- Write volume: [X writes/sec]
- Read volume: [Y reads/sec]

(1) For each relational requirement identified, evaluate whether it can be
    eliminated by access pattern redesign or must be re-implemented in
    the application layer after migration.
(2) For each access pattern, evaluate whether the proposed NoSQL store
    serves it natively or requires a secondary index, scan, or
    application-layer join.
(3) Calculate the engineering cost of re-implementing relational
    requirements in the application layer:
    - Transaction coordination: [engineering weeks]
    - Consistency guarantees: [engineering weeks]
    - Query patterns not modeled at design time: [ongoing cost]
(4) Identify the actual bottleneck: is it the relational engine itself,
    or is it an index, connection pool, or query design problem?
    Provide the EXPLAIN ANALYZE output for the slowest query.
(5) Recommend: migrate to NoSQL, tune the relational engine, or adopt
    a specialized store for the specific access pattern.
```

## Prompt 10.2 — The Sharding Strategy Audit

**When to use this:** Use this prompt when designing the sharding strategy for a table that has exceeded the scaling limits of a single relational node, or when auditing an existing sharding key that is producing hot shards or uneven distribution.

```text
Act as a Principal Database Architect specializing in horizontal sharding.
I am evaluating the sharding strategy for the following table:

Table name: [Name]
Current row count: [N rows]
Write volume: [X writes/sec]
Read volume: [Y reads/sec]
Primary access patterns: [list of read queries with frequency]
Current bottleneck: [write IOPS / lock contention / single-node capacity]
Proposed sharding key: [key or key combination]

I will provide a 30-day sample of production query logs.
[Paste query log sample or access pattern summary]

(1) Evaluate the proposed sharding key against the production access
    patterns: does it distribute writes uniformly, or does the access
    pattern produce hot shards for specific key values?
(2) Identify the cross-shard query impact: which production queries
    will require scatter-gather after sharding? Calculate the latency
    penalty for the N highest-frequency cross-shard queries.
(3) Evaluate whether table partitioning within a single node can
    address the bottleneck before sharding is required.
(4) If sharding is required, recommend the shard count and key:
    - Natural key vs. hash: which provides better distribution?
    - Composite key: which combination balances locality and distribution?
(5) Define the migration plan: how does data move from the current
    single-node table to the sharded layout without downtime?
    Include the rollback trigger: at what point does the migration abort?
```

## Prompt 10.3 — The Index Audit

**When to use this:** Use this prompt when write performance is degrading on a high-write table, when write IOPS are disproportionately high relative to write volume, or as a routine quarterly maintenance audit on tables with more than 5 indexes.

```text
Act as a Principal Database Performance Engineer. I am auditing the
index set for the following table:

Table name: [Name]
Row count: [N rows]
Write volume: [X writes/sec]
Current write p99: [Nms]
Current index count: [N]

I will provide:
1. The table schema with all index definitions.
2. The pg_stat_user_indexes output for the past 30 days.
3. The EXPLAIN ANALYZE output for the 10 highest-frequency queries.

[Paste schema, index stats, query plans]

(1) Classify each index as: Active-Necessary, Active-Redundant,
    Inactive-Historical, or Over-Specific.
(2) For Active-Redundant indexes: identify which covering index
    can serve the same queries with minor query rewrites.
(3) For Inactive-Historical indexes: verify no application code
    references the index by name. Provide the DROP INDEX statement.
(4) Calculate the write IOPS reduction from removing the identified
    candidate indexes: [removed indexes] x [writes/sec] = IOPS saved.
(5) For each remaining index, verify selectivity: for the queries
    that use this index, what percentage of rows does the filter
    return? Flag any index applied to a filter with > 10% selectivity.
```

## Prompt 10.4 — The Data Access Layer Design Review

**When to use this:** Use this prompt when designing the DAL for a sharded or multi-store data architecture, or when auditing an existing DAL for routing correctness, consistency model compliance, and operational resilience.

```text
Act as a Principal Data Architecture Engineer. I am designing the
Data Access Layer for a system with the following data stores:

Primary database: [type, shard count if applicable]
Read replicas: [count, replication lag, regions]
Search engine: [type, index freshness SLO]
Cache layer: [Redis, TTL ranges by data type]

Application services using the DAL: [list of services]

For each service, I will provide the list of read and write operations
with their consistency requirements:
[Paste operation list with consistency requirements]

(1) For each read operation, assign the correct data source based on
    consistency requirement:
    - Strong consistency: primary
    - Read-your-writes: primary with sticky window
    - Eventual (seconds tolerance): replica
    - Full-text search: search engine
    - Analytical aggregate: analytics replica
(2) For each write operation, validate that it routes to the primary
    and that the shard key is correctly derived from the operation input.
(3) Design the shard registry: format, storage location, refresh interval,
    and failure behavior when the registry is unavailable.
(4) Define the DAL fallback behavior for each data source failure:
    - Primary unavailable: fail writes, route reads to replica with alert
    - Replica unavailable: route reads to primary with latency warning
    - Search engine unavailable: fall back to database LIKE with alert
(5) Define the shadow mode validation protocol for DAL changes.
```

## Prompt 10.5 — The Search Engine Migration Audit

**When to use this:** Use this prompt when evaluating whether to migrate product search from a database LIKE query to a dedicated search engine, or when auditing an existing search engine deployment for operational correctness.

```text
Act as a Principal Search Architecture Engineer. I am evaluating the
migration of [Table/Service Name] from database LIKE queries to a
dedicated search engine.

Current state:
- Database: [type]
- Table row count: [N rows]
- Current search query volume: [X queries/sec]
- Current search p99 latency: [Nms]
- Search abandonment rate: [X%]
- IOPS consumed by search queries: [X% of provisioned]
- Query types: [list: exact match / full-text / faceted / geospatial]

(1) Evaluate whether the current query volume and complexity justify
    a dedicated search engine. Apply the migration signal thresholds.
(2) If migration is recommended, design the index schema:
    - Which fields are searchable? Which are filterable? Which are sortable?
    - What relevance boosting is required (recency, popularity, category)?
(3) Design the CDC pipeline from the source database to the search index:
    - What events trigger an index update?
    - What is the acceptable index freshness lag?
    - How are deletions propagated to the search index?
(4) Define the re-indexing procedure for schema changes:
    - Blue-green index swap: create new, validate, cut over, delete old
    - What query set validates result quality before cutover?
(5) Define the fallback behavior when the search engine is unavailable:
    - Fall back to database LIKE with a user-visible warning, or
    - Return a degraded response (no results) with a retry suggestion?
```
