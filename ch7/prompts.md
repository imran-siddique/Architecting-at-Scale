# Chapter 7 — Architect's Prompts

**Scaling Service Infrastructure – Resilience, Mesh, and Compute**

The Architect's Prompts from Chapter 7, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [7.1 The Service Discovery Readiness Audit](#prompt-7-1-the-service-discovery-readiness-audit) | Use this prompt before your first multi-service production deployment, or when evaluating… |
| [7.2 The Resilience Policy Audit](#prompt-7-2-the-resilience-policy-audit) | Use this prompt when designing the circuit breaker and retry configuration for a new service… |
| [7.3 The Bulkhead Configuration Audit](#prompt-7-3-the-bulkhead-configuration-audit) | Use this prompt when designing the resource isolation strategy for a service with multiple… |
| [7.4 The Compute Strategy Audit](#prompt-7-4-the-compute-strategy-audit) | Use this prompt during an architecture review when evaluating the runtime strategy for a new… |
| [7.5 The Auto-Scaling Policy Audit](#prompt-7-5-the-auto-scaling-policy-audit) | Use this prompt when designing or auditing the auto-scaling configuration for a service, or… |

---

## Prompt 7.1 — The Service Discovery Readiness Audit

**When to use this:** Use this prompt before your first multi-service production deployment, or when evaluating whether an existing service discovery implementation is sufficient for your current reliability requirements.

```text
Act as a Principal Platform Engineer. I am deploying [N] services
to a Kubernetes cluster. I need to evaluate whether my current
service discovery implementation is sufficient for production.

Current state:
- Service discovery mechanism: [DNS / hardcoded IPs / environment variables]
- mTLS status: [None / Application-layer / Mesh-layer]
- Traffic shifting capability: [None / Feature flags / Service mesh]
- Distributed tracing: [None / Manual header propagation / Automatic injection]
- Production readiness stage: [Private Preview / Public Preview / GA]

For each service-to-service call in the following dependency graph:
[Paste service dependency graph]

(1) Identify any call using a hardcoded IP or environment-variable address.
(2) For each risk, provide the Kubernetes Service and DNS name configuration.
(3) Based on production readiness stage, recommend whether a full service
    mesh is justified or application-layer resilience libraries are sufficient.
(4) If a service mesh is recommended, provide the minimum viable Istio
    configuration: mTLS, traffic shifting, and tracing injection policies.
(5) Define the mesh adoption rollback plan and estimated engineering cost.
```

## Prompt 7.2 — The Resilience Policy Audit

**When to use this:** Use this prompt when designing the circuit breaker and retry configuration for a new service boundary, or when auditing an existing configuration that has produced false positives or false negatives.

```text
Act as a Principal Reliability Engineer specializing in distributed
systems resilience. I am configuring retry and circuit breaker policies
for the following service dependency:

Consuming service: [Name, p99 latency SLO, connection pool size]
Dependency service: [Name, p99 latency, current error rate, RPS]
Failure mode being protected against: [Timeout / Error spike / Latency degradation]
Acceptable false positive rate: [X% of circuit open events on healthy services]

Current retry configuration (if any):
- Max retries: [N]
- Backoff strategy: [None / Fixed / Exponential]
- Jitter: [Yes / No]
- Retry budget: [None / X%]

Current circuit breaker configuration (if any):
- Minimum request volume: [N]
- Error rate threshold: [X%]
- Sleep window: [Ns]
- Graduated throttling: [Yes / No]

(1) Calculate the maximum retry amplification factor under the current
    configuration. If amplification exceeds 2x, flag as a risk.
(2) Evaluate circuit breaker thresholds against current RPS and error rate.
    Identify whether configuration risks false positives or false negatives.
(3) Recommend a bounded retry policy with specific values for exponential
    backoff base, jitter range, and retry budget percentage.
(4) Recommend a graduated circuit breaker configuration with three traffic
    reduction stages before full open.
(5) Define the minimum observable metrics to validate the configuration
    in production: which state transition events must be emitted as metrics,
    and what alert threshold fires when false positive rate exceeds bounds?
```

## Prompt 7.3 — The Bulkhead Configuration Audit

**When to use this:** Use this prompt when designing the resource isolation strategy for a service with multiple downstream dependencies of different priority levels, or after a connection pool exhaustion event to identify which isolation boundaries were missing.

```text
Act as a Principal Reliability Engineer. I am designing the bulkhead
and timeout configuration for [Service Name] with the following
downstream dependencies:

[For each dependency, provide:]
- Dependency name and priority level (P0 / P1 / P2)
- p99 response time (normal conditions)
- p99 response time (degraded conditions)
- Maximum concurrent requests this service sends to this dependency
- Current connection/thread pool size for this dependency (if any)
- Current timeout configuration (if any)

Total service memory budget: [X MB]
Maximum acceptable P0 latency impact from P2 degradation: [Nms]

(1) For each dependency, calculate the correct connection/thread pool size
    using: (p99 degraded response time) x (max concurrent requests) x 1.5.
(2) Identify any dependency where the current pool size is below the
    calculated requirement — these are exhaustion risks.
(3) Recommend the isolation strategy for each dependency:
    thread pool vs. semaphore, with justification.
(4) Define the timeout hierarchy from the outermost layer (user browser
    or API Gateway) to this service’s downstream calls. Ensure each
    layer’s timeout is strictly less than the layer above it.
(5) Define the load shedding policy: at what capacity utilization
    percentage should P2 requests begin being shed?
```

## Prompt 7.4 — The Compute Strategy Audit

**When to use this:** Use this prompt during an architecture review when evaluating the runtime strategy for a new service, or when auditing an existing service that may be on the wrong runtime for its current workload profile.

```text
Act as a Principal Infrastructure Architect. I am evaluating the
compute strategy for [Service Name] with the following properties:

- Workload type: [Stateless request handler / Stateful / Event processor /
  Batch job / Stream processor]
- Priority level: [P0 / P1 / P2]
- Expected sustained RPS: [X]
- p99 latency SLO: [Nms]
- State requirements: [None / Session state / Persistent storage]
- Downstream connections: [Number and type of persistent connections required]
- Maximum acceptable cold start latency: [Nms]
- Expected execution time per request (p99): [Nms or Ns]

Current runtime (if any): [Lambda / Kubernetes / VM / Bare Metal]
Current infrastructure cost: [$X/month]
Current operational overhead (engineering hours/month): [N hours]

(1) Evaluate whether the current runtime is appropriate for the workload
    profile. Flag any mismatch between P0 requirements and serverless
    cold start or execution time constraints.
(2) If a runtime migration is recommended, provide:
    - Estimated migration effort in engineering-days.
    - Portability risks in the current implementation.
    - A migration sequence that maintains availability during cutover.
(3) Calculate the total cost of ownership comparison:
    - Current: infrastructure cost + operational overhead cost.
    - Recommended: infrastructure cost + operational overhead cost.
    - Break-even period for any migration investment.
(4) Define the managed vs. self-managed recommendation with specific
    justification based on team size and platform engineering capacity.
```

## Prompt 7.5 — The Auto-Scaling Policy Audit

**When to use this:** Use this prompt when designing or auditing the auto-scaling configuration for a service, or after a traffic spike caused degraded performance that the auto-scaler failed to absorb within the SLO window.

```text
Act as a Principal Capacity Engineering specialist. I am designing the
auto-scaling policy for [Service Name] with the following properties:

- Priority level: [P0 / P1 / P2]
- p99 latency SLO: [Nms]
- Current scaling signal: [CPU / Memory / RPS / Queue depth / Custom]
- Current HPA min replicas: [N]
- Current HPA max replicas: [N]
- Current scale-up threshold: [X% CPU or Nms latency]
- Current cooldown period: [Ns]
- Traffic pattern: [Uniform / Daily cycle / Spiky / Event-driven]
- Peak traffic time (if predictable): [HH:MM timezone]

Historical incidents:
- Last traffic spike that caused SLO breach: [date, spike magnitude, duration]
- Observed scaling lag during that incident: [N seconds]

(1) Calculate the minimum pod count required to absorb a 3x traffic spike
    without breaching the latency SLO, assuming a 90-second scaling lag
    under the current configuration.
(2) Recommend a scaling signal upgrade: identify whether the current signal
    should be replaced with latency or queue depth, and provide the KEDA
    or HPA custom metrics configuration.
(3) If the traffic pattern has a predictable daily or weekly cycle,
    generate a cron-based pre-scaling schedule that adds capacity
    15 minutes before the predicted peak.
(4) If this is a P2 workload, evaluate scale-to-zero eligibility and
    provide the KEDA ScaledObject configuration with queue-depth trigger.
(5) Define the PodDisruptionBudget with minAvailable appropriate for
    the service’s redundancy requirements.
```
