# Chapter 12 — Architect's Prompts

**Resilience and High Availability – Designing for Failure**

The Architect's Prompts from Chapter 12, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [12.1 The Top Scenario Classification](#prompt-12-1-the-top-scenario-classification) | Use this prompt at the start of any resilience design exercise, before any circuit breaker… |
| [12.2 The Graceful Degradation Design](#prompt-12-2-the-graceful-degradation-design) | Use this prompt when designing the fallback architecture for a P0 flow, or when a P0 flow… |
| [12.3 The Resilience Configuration Audit](#prompt-12-3-the-resilience-configuration-audit) | Use this prompt when auditing circuit breaker and bulkhead configuration across a… |
| [12.4 The Load Shedding Policy Design](#prompt-12-4-the-load-shedding-policy-design) | Use this prompt when designing the load shedding policy for a system serving mixed traffic… |
| [12.5 The Chaos Experiment Design](#prompt-12-5-the-chaos-experiment-design) | Use this prompt when designing a chaos experiment for a specific resilience mechanism, or… |

---

## Prompt 12.1 — The Top Scenario Classification

**When to use this:** Use this prompt at the start of any resilience design exercise, before any circuit breaker or bulkhead policy is configured.

```text
Act as a Principal Resilience Architect. I am defining the Top Scenarios
for [System Name] to drive the resilience architecture.

I will provide a list of all user-facing features and flows.
[Paste feature list with brief description of each]

(1) Apply the Top Scenario Test to each feature: classify as P0, P1, or P2.
(2) For each P0: identify the P0P0 — the irreducible minimum output
    that must be produced even when the full P0 scenario cannot complete.
(3) Define the degradation contract for each P0 service:
    P0P0 outputs: always guaranteed.
    P1 behaviors: disabled under [specific condition].
    P2 behaviors: disabled first.
(4) Identify resource conflicts: which P0 and P2 services share
    compute, connection pools, or database tables?
(5) Define the SLO for each tier:
    P0: [availability target, p99 latency SLO]
    P1: [availability target, acceptable degraded state]
    P2: [availability target or best effort]
```

## Prompt 12.2 — The Graceful Degradation Design

**When to use this:** Use this prompt when designing the fallback architecture for a P0 flow, or when a P0 flow currently has all-or-nothing failure behavior.

```text
Act as a Principal Resilience Engineer. I am designing the graceful
degradation architecture for [P0 Flow Name].

Current full response dependencies:
[List all services, databases, caches, and external APIs in this flow]

(1) Classify each dependency: P0P0-critical, P0-required, or Shedable.
(2) For each Shedable dependency: define the Basic Minimum Response
    that the system produces without it.
(3) Define the feature flag for each Shedable dependency:
    - Auto-disable trigger: what health signal disables the flag?
    - Auto-enable trigger: what health signal re-enables the flag?
(4) Design the fallback path: what cached, static, or simplified data
    replaces the live dependency? What is the maximum acceptable staleness?
(5) Define the production testing protocol: what percentage of production
    traffic continuously exercises the fallback path?
```

## Prompt 12.3 — The Resilience Configuration Audit

**When to use this:** Use this prompt when auditing circuit breaker and bulkhead configuration across a multi-service architecture, or after a cascading failure event.

```text
Act as a Principal Reliability Engineer. I am auditing the resilience
configuration for the following service architecture:

[For each service: priority tier, downstream dependencies,
current circuit breaker config, pool sizes, timeouts]

(1) For each P0 service: verify its connection pool and thread pool
    are dedicated. Flag any shared resource between P0 and P2 paths.
(2) For each circuit breaker: verify thresholds match path priority.
    P0 breakers should open later; P2 breakers should open earlier.
(3) For each timeout: verify the hierarchy is correct —
    each layer’s timeout is strictly less than the layer above it.
(4) Calculate the pool sizing for each P0 downstream dependency:
    (p99 degraded response time) x (max concurrent requests) x 1.5.
    Flag any pool below the calculated minimum.
(5) Identify any P0 service sharing node capacity with P2 workloads
    without a PodDisruptionBudget or PriorityClass.
```

## Prompt 12.4 — The Load Shedding Policy Design

**When to use this:** Use this prompt when designing the load shedding policy for a system serving mixed traffic types, or after a capacity incident where non-critical traffic consumed resources needed for P0 flows.

```text
Act as a Principal Capacity Engineer specializing in load shedding.
I am designing the load shedding policy for [System Name].

Traffic profile:
- Human user traffic: [X% of total, request types]
- Automated / API client traffic: [Y% of total]
- LLM / agent traffic: [Z% of total, request patterns]

Current capacity utilization at peak: [X%]

(1) Define the shed threshold for each traffic type, from lowest
    priority (shed first) to highest priority (shed last).
(2) For each traffic type: define the shed mechanism:
    429 with Retry-After, degraded response, or connection reset.
(3) Design the token bucket rate limiter for LLM/agent traffic:
    bucket size, refill rate, per-key or per-tier enforcement.
(4) Calculate the capacity recovery from shedding LLM/agent traffic:
    [agent request volume] x [avg resource cost] = saved capacity.
(5) Define the auto-restore trigger: at what capacity utilization
    does shedding stop and full service resume?
```

## Prompt 12.5 — The Chaos Experiment Design

**When to use this:** Use this prompt when designing a chaos experiment for a specific resilience mechanism, or when building the initial chaos testing program for a system never tested under controlled failure conditions.

```text
Act as a Principal Chaos Engineering Specialist. I am designing a
chaos experiment to validate [Resilience Mechanism].

Resilience mechanism under test: [e.g. circuit breaker on Pricing service]
Expected behavior: [e.g. circuit opens at 30% error rate; traffic shifts
to cached pricing fallback within 10 seconds]
Current ring: [Ring 0 / Ring 1 / Ring 2]

Experiment design:
(1) Fault type: [pod kill / latency injection / error injection / resource exhaustion]
(2) Fault magnitude and duration.
(3) Blast radius: which accounts or traffic percentage are affected?
(4) Success criteria: what observable signals confirm the mechanism
    activated as designed?
(5) Abort criteria: at what observed impact does the experiment stop?
(6) Rollback procedure: how is the fault removed if abort fires?
(7) Proceed criteria: what must be true before escalating to the next ring?
```
