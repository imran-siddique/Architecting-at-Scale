# Chapter 14 — Architect's Prompts

**Cost Optimization and Efficiency (FinOps)**

The Architect's Prompts from Chapter 14, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [14.1 The Cost Surprise Audit](#prompt-14-1-the-cost-surprise-audit) | Use this prompt when the cloud bill has grown faster than your tracked compute and storage,… |
| [14.2 The Weekly Cost Trend Review](#prompt-14-2-the-weekly-cost-trend-review) | Use this prompt to structure the cost portion of your weekly production fundamentals review… |
| [14.3 The Managed-Versus-Self-Host Decision](#prompt-14-3-the-managed-versus-self-host-decision) | Use this prompt when an engineer proposes self-hosting an open-source equivalent to save a… |
| [14.4 The Unit Economics Model](#prompt-14-4-the-unit-economics-model) | Use this prompt to build the cost-per-unit model that turns a raw cloud bill into the single… |
| [14.5 The AI Cost Governance Design](#prompt-14-5-the-ai-cost-governance-design) | Use this prompt when an AI feature's token cost is climbing without a matching rise in… |

---

## Prompt 14.1 — The Cost Surprise Audit

**When to use this:** Use this prompt when the cloud bill has grown faster than your tracked compute and storage, and you need to find the unexamined platform-service spend before the next budget review.

```text
Act as a Principal FinOps Engineer. I am auditing a cloud bill that has
grown faster than our compute and storage footprint explains. Help me find
the platform-service spend that has no owner.

Our tracked services and their monthly compute/storage cost: [list].
Total monthly bill: [amount]. Tracked compute + storage: [amount].
The unexplained delta is [amount].

For the delta, do the following:
(1) List every platform service that bills independently of compute:
    backup/retention, snapshots, cross-zone and egress transfer, log
    ingestion/retention, idle load balancers and NAT gateways, managed
    point-in-time restore, and shared gateways.
(2) For each, identify whether the policy was set once and applied
    automatically to resources created later (the provisioned-once pattern).
(3) Flag any premium tier (geo-redundancy, long retention, HA replication)
    inherited by resources that do not justify it (the orphaned premium).
(4) For each finding, give the monthly cost, the reversible fix, the blast
    radius of that fix, and the recovery-objective check required first.
(5) Assign each line item to an owning team. Flag anything with no owner.
```

## Prompt 14.2 — The Weekly Cost Trend Review

**When to use this:** Use this prompt to structure the cost portion of your weekly production fundamentals review so it surfaces trend breaks in minutes instead of becoming a line-item audit.

```text
Act as a Principal Engineer running a weekly production fundamentals
review. Help me review cost as a trend, not as an absolute number.

Here is this week's data versus the trailing eight weeks:
- Total spend trend: [series]
- Cost per order: [series]
- Cost per AI request, per feature: [series]
- Spend by team: [series]
- Untagged spend %: [series]
- Business volume (orders, active users): [series]

Do the following:
(1) For each cost series, compare its slope to the business-volume slope.
(2) Flag ONLY the series whose slope breaks from business volume. Ignore
    increases that are proportional to traffic, orders, or users.
(3) For each flagged series, list the likely causes: a new feature with bad
    unit economics, a runaway job, a retry storm, or a disabled cache.
(4) Recommend the single highest-signal metric to add to next week's review.
(5) Keep the healthy-state summary to two sentences. Do not audit line items
    that are tracking business volume.
```

## Prompt 14.3 — The Managed-Versus-Self-Host Decision

**When to use this:** Use this prompt when an engineer proposes self-hosting an open-source equivalent to save a managed-service premium, and you need to convert the argument from opinion into a break-even calculation.

```text
Act as a Principal Engineer evaluating whether to self-host an open-source
service or keep a managed equivalent. Resolve this with a break-even
calculation, not a preference.

Managed service: [name], current cost [amount/mo].
Self-hosted equivalent: [OSS project], maturity: [assessment].
Estimated raw infrastructure cost if self-hosted: [amount/mo].
Loaded cost of one engineer per week: [amount].
This workload sits on a: [P0 / P1 / P2] path.

Do the following:
(1) Compute the annual managed premium (managed cost minus self-hosted
    infra cost) and convert it to engineering weeks at the loaded rate.
(2) Estimate the engineering weeks self-hosting will consume: initial build,
    plus annual operational load (patching, failover, upgrades, incidents).
(3) State the break-even and the recommendation.
(4) Name the tax on each side: managed lock-in versus self-hosted operations.
(5) If the path is P0, raise the bar: require the operational load to be
    clearly below the premium before recommending self-hosting.
```

## Prompt 14.4 — The Unit Economics Model

**When to use this:** Use this prompt to build the cost-per-unit model that turns a raw cloud bill into the single trend line your weekly review can act on.

```text
Act as a Principal FinOps Engineer. Help me build a unit-economics model
that converts our cloud bill into cost per unit of business value.

Business unit we sell: [order / query / resolved request / active user].
Monthly business volume: [number]. Monthly total spend: [amount].
Current tagging coverage: [percent tagged]. Major services: [list].

Do the following:
(1) Define the cost-per-unit metric and the denominator to track weekly.
(2) Specify the mandatory tags (owner, service, environment, feature) and
    the provisioning-time enforcement that rejects untagged resources.
(3) Map each major service's spend to the unit so cost per unit is
    attributable by feature and team.
(4) Define the FinOps feedback loop stages (measure, attribute, surface,
    act, verify) and the owner for each stage.
(5) Recommend a cost-aware autoscaling ceiling per service and the alert
    that fires when it is reached.
```

## Prompt 14.5 — The AI Cost Governance Design

**When to use this:** Use this prompt when an AI feature's token cost is climbing without a matching rise in usage, and you need to put enforcement, tiered budgets, and a model cascade in place before the feature goes wider.

```text
Act as a Principal Engineer who has built runtime cost governance for
autonomous agents. Help me govern the token cost of an AI feature.

Feature: [name]. Model in use: [model]. Current cost per outcome: [amount].
Outcome unit: [resolved ticket / recommendation / generated draft].
Current per-call path: [is there a single chokepoint, or raw calls?].
Step/retry behavior: [is there a hard cap, or can it loop?].

Do the following:
(1) Identify whether every model call passes through one guarded chokepoint.
    Flag any raw call site that bypasses the budget.
(2) Specify enforcement (reject before the call), not just monitoring.
(3) Define tiered budgets: per task, per agent per day, and per user.
(4) Set a hard cap on reasoning steps and retries per task.
(5) Design a model cascade: which requests start on the cheap tier and what
    signal escalates them to a more expensive model.
(6) Compute the projected cost per outcome after these changes, and state
    the threshold at which this feature should be redesigned or retired.
(7) Stage the budget cutoff so an exhausted session hands off its partial
    result rather than wasting the tokens already spent.
```
