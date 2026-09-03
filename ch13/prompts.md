# Chapter 13 — Architect's Prompts

**Performance Tuning and Capacity Planning**

The Architect's Prompts from Chapter 13, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [13.1 The Optimization Decision Audit](#prompt-131--the-optimization-decision-audit) | Use this prompt before starting any performance optimization project, or when a team is… |
| [13.2 The Contention Audit](#prompt-132--the-contention-audit) | Use this prompt when P0 p99 latency is degrading intermittently without a corresponding… |
| [13.3 The Performance Budget Audit](#prompt-133--the-performance-budget-audit) | Use this prompt when infrastructure costs are growing faster than traffic, or when reviewing… |
| [13.4 The Capacity Planning Model](#prompt-134--the-capacity-planning-model) | Use this prompt to build or update the capacity plan for a P0 service, or before any planned… |
| [13.5 The Good Enough Audit](#prompt-135--the-good-enough-audit) | Use this prompt when reviewing the engineering backlog for optimization work that may have… |

---

## Prompt 13.1 — The Optimization Decision Audit

**When to use this:** Use this prompt before starting any performance optimization project, or when a team is considering hardware provisioning vs. engineering optimization.

```text
Act as a Principal Performance Engineer. I am evaluating whether to
optimize [Component/Workload] or provision additional hardware.

Current state:
- Measured performance problem: [latency / IOPS / CPU / memory]
- Current metric value: [X]
- Target metric value: [Y]
- Root cause hypothesis: [resource-bound / algorithm inefficiency / contention]

(1) Confirm the root cause: is the problem resource-bound (hardware option
    exists) or algorithm-bound (optimization required regardless of hardware)?
(2) Calculate the hardware option cost:
    - What hardware change resolves the problem? (instance upgrade / node add)
    - Monthly cost delta: [$X/month]
    - Time to implement: [hours]
(3) Calculate the optimization cost:
    - Estimated engineering weeks to implement and validate
    - Fully-loaded engineering cost: [weeks x daily rate]
(4) Apply the Optimization ROI Test:
    - Is 12-month hardware cost < engineering optimization cost?
    - If yes: provision hardware. State clearly.
    - If no: proceed with optimization. Provide the profiling approach.
(5) If optimization is warranted: define the measurement baseline
    (EXPLAIN ANALYZE / profiler output / benchmark result) before
    any code is changed.
```

## Prompt 13.2 — The Contention Audit

**When to use this:** Use this prompt when P0 p99 latency is degrading intermittently without a corresponding increase in P0 traffic, suggesting resource contention from a co-located workload.

```text
Act as a Principal Performance Engineer specializing in resource contention.
I am diagnosing intermittent P0 performance degradation on [P0 Service].

Symptoms:
- P0 service p99 latency: [Xms normal, Yms during degradation windows]
- Degradation window pattern: [time of day / correlated with job execution / random]
- P0 traffic volume during degradation: [same / lower / higher than normal]

Co-located workloads on the same node pool:
[List all services and jobs running on the same Kubernetes node pool]

(1) Correlate P0 p99 spikes with co-located workload execution times.
    Is there a statistically significant correlation?
(2) For the correlated workload: measure its peak CPU, memory, and IOPS
    consumption during the window where P0 degrades.
(3) Calculate the resource headroom available to P0 during the contention
    window: [node capacity] - [P2 consumption] = [P0 available].
(4) Compare [P0 available] against [P0 resource requirements at p99 SLO].
    If P0 available < P0 requirements: physical separation is required.
(5) Design the separated infrastructure:
    - P0 node pool: instance type, min/max node count, auto-scaling signal
    - P2 background pool: instance type, execution window constraints,
      resource budget (CPU %, memory limit, IOPS limit, max duration)
```

## Prompt 13.3 — The Performance Budget Audit

**When to use this:** Use this prompt when infrastructure costs are growing faster than traffic, or when reviewing the resource allocation across workload tiers for a system that has accumulated infrastructure without a tiering framework.

```text
Act as a Principal Capacity Engineer. I am auditing the performance
budget allocation for [System Name] with the following workload tiers:

[For each workload, provide: name, tier (P0/P1/P2), current instance type,
current monthly cost, measured p99 latency, target p99 latency SLO]

(1) For each P2 workload running on on-demand compute:
    - Is the workload interruptible? (can a spot reclamation be handled?)
    - Is the workload time-flexible? (does it have a completion window, not a moment?)
    - If both yes: calculate the spot instance cost at 60% discount.
(2) For each P0 workload:
    - Is it provisioned at the minimum required to meet SLO, or at excess?
    - Calculate the minimum instance size that meets the p99 SLO under peak load.
(3) Identify any P2 workload on P0-grade hardware.
    What is the monthly cost delta of downgrading to the correct tier?
(4) Identify any P0 workload sharing node capacity with P1 or P2 workloads.
    Design the physical separation.
(5) Calculate the total monthly savings from:
    - Moving P2 workloads to spot instances
    - Right-sizing P0 workloads to minimum required capacity
    - Separating mixed-tier node pools
```

## Prompt 13.4 — The Capacity Planning Model

**When to use this:** Use this prompt to build or update the capacity plan for a P0 service, or before any planned high-traffic event.

```text
Act as a Principal Capacity Planning Engineer. I am building the
capacity model for [P0 Service] with the following current state:

Current peak traffic: [X RPS]
Current provisioned capacity: [N nodes / instances]
Current peak resource utilization: [X% CPU / Y% memory / Z% IOPS]
Historical traffic growth rate: [X% per month over last 6 months]
Known upcoming high-traffic events: [list with dates and expected traffic multiplier]

(1) Calculate the current headroom percentage:
    [provisioned capacity] / [peak demand] x 100.
    Is this within the 120-150% target range?
(2) Project the date at which the system will breach 100% provisioned
    capacity at the current growth rate.
(3) Calculate the capacity required for each known high-traffic event.
    Does current provisioning cover the expected peak at 150% headroom?
(4) Define the scaling procedure that must be executed if the 100% capacity
    date is reached:
    - What specific action adds capacity? (node add / instance resize)
    - How long does the action take to complete?
    - Who executes it, and what is the trigger metric?
(5) Define the scaling readiness drill: what is the procedure to test
    the scaling action in a non-incident context, and when was it last run?
```

## Prompt 13.5 — The Good Enough Audit

**When to use this:** Use this prompt when reviewing the engineering backlog for optimization work that may have passed the good enough threshold, or when making the decision to continue or stop a performance optimization project.

```text
Act as a Principal Engineering Manager evaluating performance optimization
investments. I am reviewing the following optimization projects in progress:

[For each project: component name, current p99, good enough threshold,
target p99, estimated engineering weeks remaining, user impact of target vs. current]

For each project:
(1) Is the current performance at or below the good enough threshold?
    If at threshold: stop the optimization and redirect the engineering capacity.
(2) If above threshold: calculate the user-perceptibility of the gap.
    Is the difference between current and threshold noticeable to a user?
    If not perceptible: reconsider whether the threshold was set correctly.
(3) For each project above threshold: calculate the engineering cost to reach
    threshold vs. the engineering cost to reach the proposed target.
    Is the additional cost beyond threshold justified by user impact?
(4) What is the backlog opportunity cost of continuing the optimization?
    What feature(s) could be shipped in the remaining engineering weeks?
(5) Make the recommendation: stop optimization (at good enough threshold),
    continue to threshold (below threshold), or continue beyond threshold
    (with explicit justification for why the additional cost is worth it).
```
