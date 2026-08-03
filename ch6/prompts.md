# Chapter 6 — Architect's Prompts

**Architecting Scalable Services – Decomposition and API Design**

The Architect's Prompts from Chapter 6, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [6.1 The Decomposition Readiness Audit](#prompt-6-1-the-decomposition-readiness-audit) | Use this prompt when evaluating a legacy monolith for decomposition. Run it before the first… |
| [6.2 The Protocol Selection Audit](#prompt-6-2-the-protocol-selection-audit) | Use this prompt when evaluating whether an existing internal REST API should be migrated to… |
| [6.3 The Data Ownership Audit](#prompt-6-3-the-data-ownership-audit) | Use this prompt before beginning any service extraction that involves shared database… |
| [6.4 The API Governance Audit](#prompt-6-4-the-api-governance-audit) | Use this prompt when establishing a governance baseline for existing internal APIs, or when… |
| [6.5 The Strangler Fig Migration Plan](#prompt-6-5-the-strangler-fig-migration-plan) | Use this prompt at the beginning of a decomposition project, before any extraction work… |

---

## Prompt 6.1 — The Decomposition Readiness Audit

**When to use this:** Use this prompt when evaluating a legacy monolith for decomposition. Run it before the first architectural decision is made—before any service is named, before any team is assigned, before any API contract is drafted.

```text
Act as a Principal Software Architect specializing in monolith decomposition.
I have a backend monolith with the following characteristics:

- [Number] modules sharing a single relational database
- Average build time: [X] minutes
- Deployment success rate: [Y]%
- p99 database lock contention events per day: [Z]
- Team count contributing to the shared repository: [N]

I am going to paste the following data:
1. A list of modules with their read/write ratios, team ownership, and external caller counts.
2. The last 30 days of deployment incident reports.
3. The current database schema showing foreign key relationships between module-owned tables.

[Paste module inventory, incident log, and schema]

For each module, calculate:
(1) A Coupling Coefficient: number of other modules affected by an independent deployment,
    weighted by incident frequency.
(2) A Pain Score: composite of lock contention frequency, test blast radius,
    and deployment block frequency.
(3) An Infrastructure Risk Score: how much this extraction depends on
    deployment infrastructure that is not yet validated.

Output a prioritized extraction sequence. For each module, specify:
- Extraction priority (1 = first)
- Recommended strategy (Strangler Fig / Direct Extract / Event Consumer)
- Minimum infrastructure prerequisites before extraction begins
- Rollback trigger definition (the specific metric threshold that should
  trigger reverting to the monolith path)
- Estimated blast radius if the extraction fails at 100% traffic routing
```

## Prompt 6.2 — The Protocol Selection Audit

**When to use this:** Use this prompt when evaluating whether an existing internal REST API should be migrated to gRPC, or when designing the initial communication protocol for a new service boundary.

```text
Act as a Principal API Architect. I am evaluating the communication
protocol between two internal services:

Service A: [Name, team ownership, deployment cadence]
Service B: [Name, team ownership, deployment cadence]

Current protocol: [REST/JSON or gRPC or event-based]
Sustained RPS on this path (p50): [X]
Sustained RPS on this path (p99 spike): [Y]
Average payload size: [Z KB]
Current p99 latency for this call: [Nms]
Number of contract-violation incidents in the last 90 days: [N]

Evaluate:
(1) Is JSON serialization overhead measurable in the current p99 latency budget?
    Provide the calculation.
(2) Does the deployment cadence mismatch between Service A and Service B
    create material breaking-change risk under the current protocol?
(3) What is the operational cost of migrating to gRPC, expressed as
    engineering-days for stub regeneration, schema registry setup,
    and Buf CLI integration?
(4) At what RPS threshold does the ROI of the gRPC migration become
    positive, given the operational cost calculated in (3)?

Output a protocol recommendation with a specific trigger condition for
migration—expressed as a measurable threshold, not a subjective judgment.
```

## Prompt 6.3 — The Data Ownership Audit

**When to use this:** Use this prompt before beginning any service extraction that involves shared database tables. Run it against your current schema and access log to identify all hidden data coupling before a single line of migration code is written.

```text
Act as a Principal Data Architect specializing in service decomposition.
I am extracting [Service Name] from a shared monolith database.

The current shared database has [N] tables. I am going to provide:
1. The schema for all tables that [Service Name] currently reads or writes.
2. A 30-day access log showing which modules read or write each table.
3. The proposed new schema for [Service Name]’s isolated database.

[Paste schema, access log, and proposed new schema]

For each table in the current schema that [Service Name] accesses:
(1) Identify every other service or module that also accesses this table.
(2) Classify the access as: Owner (writes and reads, should own the table),
    Consumer (reads only, should call an API instead), or Shared Writer
    (writes and reads — a boundary violation requiring resolution).
(3) For every Shared Writer, propose a resolution: which service becomes
    the Single Authority, and what API contract should the other writer call?

Then, for the proposed new schema:
(4) Identify any column that does not have a clear owning service.
(5) Flag any foreign key that crosses the new service boundary.
(6) Generate a dual-write migration plan: what must be true before Stage 2
    begins, what metrics confirm Stage 2 is complete, and what batch size
    is safe for Stage 3 given the current database I/O utilization.
```

## Prompt 6.4 — The API Governance Audit

**When to use this:** Use this prompt when establishing a governance baseline for existing internal APIs, or when onboarding a new service into an organization that already has a service registry and CI governance pipeline.

```text
Act as a Principal API Governance Engineer. I am auditing the internal
API contracts for a service architecture with the following properties:

- Number of internal services: [N]
- Number of registered consumers per service (average): [X]
- Current versioning strategy: [URI / Header / None]
- Current breaking-change detection: [Automated / Manual / None]
- Last breaking-change production incident: [date and brief description]

I am going to provide:
1. The current OpenAPI specs or .proto files for all internal services.
2. The CI pipeline configuration for each service.
3. The service registry (or the absence of one).

[Paste specs, pipeline configs, registry]

For each service:
(1) Identify whether a versioning strategy is present and correctly implemented.
    Flag any service shipping without a version prefix.
(2) Identify whether breaking-change detection is automated in CI.
    Flag any service where this gate is absent or bypassed.
(3) Identify any currently deployed API version with no registered consumers
    — these are decommission candidates.
(4) Identify any field in any response contract that lacks a documented
    valid value range — these are silent breaking change risks.

Output:
- A governance gap report ordered by risk severity.
- A recommended CI gate implementation sequence.
- A deprecation SLO recommendation based on current consumer migration velocity.
- A schema registry recommendation: Git-based, Buf Schema Registry,
  or Confluent, based on current service count and growth trajectory.
```

## Prompt 6.5 — The Strangler Fig Migration Plan

**When to use this:** Use this prompt at the beginning of a decomposition project, before any extraction work begins. The output is a three-wave migration plan with defined exit criteria, a proxy decommission date, and a Residual Monolith declaration for any module whose extraction ROI does not justify the cost within the migration timeline.

```text
Act as a Principal Migration Architect specializing in monolith
decomposition using the Strangler Fig pattern.

I have a monolith with the following properties:
- Total modules: [N]
- Total lines of code: [X]
- Team size available for migration: [Y engineers]
- Maximum acceptable migration timeline: [Z weeks]
- Current deployment success rate: [%]
- Primary pain signals: [list from seam signal audit]

I am going to provide:
1. The module inventory with coupling coefficients and pain scores.
2. The current database schema with table ownership assignments.
3. The CI/CD pipeline configuration.

[Paste module inventory, schema, pipeline config]

Generate a Three-Wave Migration Plan:

Wave 1 (Infrastructure Validation):
- Select 2-3 modules based on lowest coupling coefficient and highest
  infrastructure learning value.
- Define exit criteria for Wave 1 completion.
- Define the proxy configuration policy.

Wave 2 (Pain Elimination):
- Select modules based on highest pain score from the seam signal audit.
- For each module with a data migration requirement, generate a Parallel
  Schema migration plan with dual-write window duration estimate.
- Define exit criteria: which specific metrics must recover to what values?

Wave 3 (Completion or Containment):
- For each remaining module, calculate extraction ROI:
  [engineering days] x [fully-loaded daily cost] vs. [annual benefit
  from extraction measured in incident reduction and deployment velocity].
- Modules with negative 12-month ROI: declare as Residual Monolith,
  specify wrapper API contract requirements, assign ownership.
- Modules with positive ROI: include in Wave 3 extraction sequence.

Output:
- Three-wave Gantt with week-level granularity.
- Proxy decommission date.
- Residual Monolith declaration with wrapper contract specification.
- Automated rollback trigger definitions for each cutover stage.
```
