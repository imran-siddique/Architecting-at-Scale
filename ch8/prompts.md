# Chapter 8 — Architect's Prompts

**Event-Driven Scaling – Decoupling with Messaging**

The Architect's Prompts from Chapter 8, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [8.1 The Sync-to-Async Migration Audit](#prompt-81--the-sync-to-async-migration-audit) | Use this prompt at the start of an event-driven migration, before any broker is selected or… |
| [8.2 The Broker Selection Audit](#prompt-82--the-broker-selection-audit) | Use this prompt when selecting a message broker for a new event-driven system or evaluating… |
| [8.3 The Idempotency Implementation Audit](#prompt-83--the-idempotency-implementation-audit) | Use this prompt when reviewing an existing event consumer for deduplication correctness, or… |
| [8.4 The Outbox Implementation Review](#prompt-84--the-outbox-implementation-review) | Use this prompt when reviewing an Outbox implementation before production deployment, or… |
| [8.5 The Saga Design Audit](#prompt-85--the-saga-design-audit) | Use this prompt when designing a new multi-step workflow, or when evaluating an existing… |

---

## Prompt 8.1 — The Sync-to-Async Migration Audit

**When to use this:** Use this prompt at the start of an event-driven migration, before any broker is selected or any consumer is written.

```text
Act as a Principal Systems Architect specializing in event-driven migration.
I am analyzing the following service call graph for sync-to-async
migration opportunities:

Service: [Service Name]  |  Current p99 latency: [Xms]  |  Target p99: [Yms]

Downstream synchronous calls (for each):
- Dependency name, p99 response time, operation description,
  user action immediately after this call completes

[Paste call graph or list of downstream calls]

For each downstream call:
(1) Classify: user-blocking or user-independent.
(2) For user-independent: estimate latency savings from async migration.
(3) Identify consistency risks: what is the UX if the async operation fails
    after the synchronous path has returned success?
(4) Define the compensating action: what must be reversed upstream?
(5) Recommend migration sequence based on latency savings and reversibility.

Output: classified call inventory, projected p99 after migration,
compensating action definitions, migration sequence with rollback triggers.
```

## Prompt 8.2 — The Broker Selection Audit

**When to use this:** Use this prompt when selecting a message broker for a new event-driven system or evaluating whether the current broker is appropriate for the workload's growth trajectory.

```text
Act as a Principal Infrastructure Architect specializing in event-driven systems.
I am selecting a message broker for the following workload:

Current event volume: [X events/day]
Projected event volume (12 months): [Y events/day]
Number of distinct event types: [N]
Maximum consumers per event type: [N]
Replay requirement: [Yes/No — if yes, maximum replay window]
Ordering requirement: [Global / Per-entity / None]
Team Kafka expertise: [None / One engineer / Dedicated ops]
Compliance requirements: [Audit log / Data residency / None]

(1) Evaluate whether the current workload volume justifies Kafka
    operational overhead. Show the break-even calculation.
(2) Recommend the minimum viable broker for the current workload.
(3) Define the migration trigger: at what specific measurable threshold
    should the team migrate? Express as an observable metric.
(4) If cloud pub/sub is recommended, identify vendor lock-in risks
    and broker-agnostic design patterns that mitigate them.
(5) Estimate the operational overhead delta vs. Kafka in eng-hours/month.
```

## Prompt 8.3 — The Idempotency Implementation Audit

**When to use this:** Use this prompt when reviewing an existing event consumer for deduplication correctness, or when designing the idempotency strategy for a new consumer with financial or inventory side effects.

```text
Act as a Principal Reliability Engineer specializing in event-driven consistency.
I am auditing the following event consumer for idempotency correctness:

Consumer name: [Name]
Operation: [Description — e.g. Charge payment card for order]
Side effects: [e.g. DB write to orders table + external payment API call]
Idempotency key format: [e.g. order_id + attempt_number]
Deduplication store: [Redis / DB unique constraint / None]
Deduplication store TTL: [X hours/days]
Broker message retention window: [Y hours/days]
Current duplicate rate: [Z% or unknown]

I will provide the consumer processing code:
[Paste consumer code]

(1) Is the deduplication store written atomically before processing begins?
    If check and write are separate, flag as concurrent duplicate risk.
(2) Is the deduplication store TTL >= broker message retention window?
    If not, calculate the window during which TTL expiry enables duplicates.
(3) If the consumer crashes between DB write and deduplication store write,
    what is the outcome of the next delivery?
(4) Is the idempotency key truly unique for the operation scope?
(5) Recommend the minimum deduplication implementation for this consumer.
```

## Prompt 8.4 — The Outbox Implementation Review

**When to use this:** Use this prompt when reviewing an Outbox implementation before production deployment, or when diagnosing a reliability issue in an existing event publishing pipeline.

```text
Act as a Principal Event Architecture Engineer. I am reviewing the
following Transactional Outbox implementation for production readiness:

Database: [PostgreSQL / MySQL / other]
Broker: [RabbitMQ / Kafka / Cloud Pub/Sub]
Polling interval: [Xms]
Downstream event delivery SLO: [Yms]
Expected write rate (outbox inserts/sec): [Z]

I will provide:
1. The outbox table schema.
2. The polling process code.
3. The cleanup job configuration.

[Paste schema, polling code, cleanup config]

(1) Is the outbox row written in the same DB transaction as the domain
    record? If not, identify the consistency gap.
(2) Is the polling interval consistent with the downstream SLO?
    Calculate maximum publication latency at the current interval.
(3) Is the mark-as-processed step atomic with the broker acknowledgment?
    Identify whether a crash produces a duplicate or a dropped event.
(4) Does the cleanup job bound the outbox table growth?
(5) What is the catch-up behavior after a 15-minute poller outage?
    Calculate backlog size and time to clear at current poller throughput.
```

## Prompt 8.5 — The Saga Design Audit

**When to use this:** Use this prompt when designing a new multi-step workflow, or when evaluating an existing choreography-based saga for migration to orchestration.

```text
Act as a Principal Event Architecture Engineer specializing in
distributed saga design. I am designing the following workflow:

Workflow name: [e.g. Order Fulfillment]
Steps: [list each step with the service responsible and the side effect]
Compensating actions: [for each step, the action that reverses it]
Failure scenarios: [which steps are most likely to fail and why]
Current implementation: [Choreography / Orchestration / None]

For each step:
(1) Classify side effect as: reversible or irreversible.
(2) For reversible steps: verify the compensating action is idempotent.
    If not, identify the duplicate execution risk.
(3) Recommend choreography or orchestration based on:
    - Step count, compensating action complexity,
    - Requirement for workflow state visibility

If orchestration is recommended:
(4) Design the orchestrator state machine: states, transitions,
    timeout triggers, and compensation sequences.
(5) Define the DLQ strategy: at what retry count does a step move to DLQ,
    and what automated or manual remediation is triggered?
(6) Define the observability contract: what metrics must the orchestrator
    emit to make workflow health visible?
```
