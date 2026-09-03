# Chapter 11 — Architect's Prompts

**Observability – Seeing and Understanding Your System**

The Architect's Prompts from Chapter 11, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [11.1 The Correlation Coverage Audit](#prompt-111--the-correlation-coverage-audit) | Use this prompt before deploying a new service to production, or when diagnosing a silent… |
| [11.2 The Outcome Observability Design](#prompt-112--the-outcome-observability-design) | Use this prompt when a system has infrastructure monitoring but is missing business… |
| [11.3 The Alert Rationalization Audit](#prompt-113--the-alert-rationalization-audit) | Use this prompt when alert fatigue is degrading the engineering team's ability to respond to… |
| [11.4 The Log Volume Rationalization](#prompt-114--the-log-volume-rationalization) | Use this prompt when log storage costs are growing faster than system traffic, or when… |
| [11.5 The Self-Healing Architecture Audit](#prompt-115--the-self-healing-architecture-audit) | Use this prompt when designing the automated remediation layer for a production system, or… |

---

## Prompt 11.1 — The Correlation Coverage Audit

**When to use this:** Use this prompt before deploying a new service to production, or when diagnosing a silent failure that cannot be traced across service boundaries. The output is a correlation coverage map that identifies every gap in the trace chain.

```text
Act as a Principal Observability Engineer. I am auditing the correlation
coverage for the following service dependency graph:

[Paste service dependency graph with external system boundaries marked]

For each service-to-service call:
(1) Verify that the calling service propagates the Correlation ID in the
    request header (W3C traceparent or custom header).
(2) Verify that the receiving service reads the Correlation ID from the
    header and includes it in all log lines and events it emits.

For each external system boundary:
(3) Identify the external system’s own transaction ID format.
(4) Verify that the calling service writes an ID Pair Registry entry
    at the moment of the external call: {correlation_id, external_system,
    external_id, timestamp}.

For each message queue or event bus hop:
(5) Verify that the Correlation ID is included in the message payload
    (not just the message header, which may be stripped by the broker).

Output:
- Correlation coverage map: each hop marked as Covered / Gap / External Boundary
- For each Gap: the specific field that must be added to close it
- For each External Boundary: the ID Pair Registry schema for that system
- Estimated engineering effort to close all Gaps
```

## Prompt 11.2 — The Outcome Observability Design

**When to use this:** Use this prompt when a system has infrastructure monitoring but is missing business transaction and user journey observability layers. The output is a layered metrics plan that closes the gap between infrastructure health and user outcome.

```text
Act as a Principal Observability Architect. I am designing the outcome
observability layer for the following user-facing flows:

[List each critical user flow: e.g. Checkout, Search, Account creation]

For each flow:
(1) Define the outcome metric: what is the binary measure of whether
    this flow delivered its intended result to the user?
(2) Identify where in the system this outcome metric can be instrumented:
    - At which service does a successful outcome first become observable?
    - What event or log line signals success vs. silent failure?
(3) Design the business transaction counter:
    - Metric name: [flow]_outcome_total{status=success|failure|silent_failure}
    - Where is it emitted: [service name and specific code location]
    - What constitutes a silent failure vs. an explicit error?
(4) Design the user journey synthetic monitor:
    - What sequence of API calls validates end-to-end success?
    - What is the acceptable p99 for the full sequence?
    - How frequently does the monitor run?
(5) Define the alert threshold:
    - At what outcome success rate does an alert fire?
    - Is the alert routed to PagerDuty (human required) or to automated
      remediation (system can self-correct)?
```

## Prompt 11.3 — The Alert Rationalization Audit

**When to use this:** Use this prompt when alert fatigue is degrading the engineering team's ability to respond to genuine incidents, or as a quarterly maintenance audit of the alerting system.

```text
Act as a Principal Site Reliability Engineer specializing in observability.
I am rationalizing the alert set for a system with the following properties:

Current alert count: [N]
Current alert volume: [X alerts/hour at peak]
Current estimated actionability rate: [Y% of alerts require human action]
Engineering team on-call rotation: [N engineers, N-hour shifts]

I will provide the alert history for the last 30 days:
- Alert name, fire count, duration, and documented actions taken
[Paste alert history]

For each alert:
(1) Apply the Actionability Test: in the last 30 days, what percentage
    of fires resulted in a specific human action within 10 minutes?
(2) Classify as: Actionable (keep), Automatable (convert to remediation),
    or Noise (suppress).
(3) For Automatable alerts: design the closed-loop remediation:
    - Detection signal (specific metric and threshold)
    - Remediation action (specific automated step)
    - Verification gate (metric that confirms resolution)
    - Fallback: at what point does the system page a human?
(4) For Noise alerts: recommend suppression or dashboard-only routing.
(5) Calculate the projected alert volume reduction and engineer-hour
    recovery from implementing the classifications.
```

## Prompt 11.4 — The Log Volume Rationalization

**When to use this:** Use this prompt when log storage costs are growing faster than system traffic, or when incident investigation time is dominated by log search rather than diagnosis.

```text
Act as a Principal Observability Engineer. I am rationalizing the log
volume for a system with the following properties:

Current log volume: [X TB/day]
Current log storage cost: [$Y/month]
Current log retention policy: [N days]
Current log verbosity: [Uniform level for all components / Mixed]
Average incident investigation time spent in log search: [X hours]

I will provide a sample of the current log output for 5 representative
components:
[Paste log samples]

(1) For each log sample, identify:
    - Is this a structured JSON log or free-text?
    - What verbosity level is this log line at?
    - Is the log line queryable by Correlation ID, user ID, and
      transaction ID without regex?
(2) Estimate the proportion of current log volume by level
    (ERROR / WARN / INFO / DEBUG / TRACE).
    Identify which levels can be moved to opt-in.
(3) Design the Component ID pattern:
    - What is the Component ID format for this system?
    - How is the dynamic configuration delivered to running components?
    - What is the auto-expiry mechanism for elevated log levels?
(4) Calculate the projected log volume reduction from implementing
    INFO as the default and DEBUG as opt-in.
(5) Define the structured log schema: the mandatory fields every
    log line must include, and the optional contextual fields
    by service type.
```

## Prompt 11.5 — The Self-Healing Architecture Audit

**When to use this:** Use this prompt when designing the automated remediation layer for a production system, or when auditing an existing self-healing implementation to verify that its blast radius boundaries are correctly defined.

```text
Act as a Principal Reliability Engineer specializing in automated
remediation. I am designing the self-healing architecture for a
system with the following known failure classes:

[For each failure class, provide:]
- Failure description
- Detection signal (metric, threshold, duration)
- Current manual recovery procedure (runbook steps)
- Frequency in last 30 days
- Average MTTR with current manual process

For each failure class:
(1) Evaluate automability: can the recovery steps be executed by
    a script without human judgment? If not, explain what requires
    human judgment and cannot be automated.
(2) For automatable failures: design the closed-loop remediation:
    - Remediation action (specific commands or API calls)
    - Maximum retry count before escalating to human
    - Verification gate (metric that confirms resolution)
    - Escalation trigger: what context is provided to the engineer?
(3) Define the blast radius of the remediation action:
    - What is the worst outcome if the remediation fires incorrectly?
    - Is this outcome acceptable? If not, add a verification gate
      before execution.
(4) For non-deterministic failures: design the forensic capture:
    - What state must be captured at the moment of detection?
    - Where is the case file stored and how is it surfaced to the engineer?
(5) Calculate the projected MTTR improvement from automated remediation
    for each failure class, and the total engineer-hours recovered monthly.
```
