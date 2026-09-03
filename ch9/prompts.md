# Chapter 9 — Architect's Prompts

**Caching Strategies – Faster and Cheaper Scaling**

The Architect's Prompts from Chapter 9, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [9.1 The Cache Domain Classification Audit](#prompt-91--the-cache-domain-classification-audit) | Use this prompt before designing any cache layer, to classify each data type by freshness… |
| [9.2 The Redis Configuration Audit](#prompt-92--the-redis-configuration-audit) | Use this prompt when designing the Redis configuration for a new cache deployment, or when a… |
| [9.3 The CDN Configuration Audit](#prompt-93--the-cdn-configuration-audit) | Use this prompt when auditing an existing CDN configuration for security, performance, and… |
| [9.4 The Cache Invalidation Design Review](#prompt-94--the-cache-invalidation-design-review) | Use this prompt when designing the invalidation strategy for a new cache layer, or when… |
| [9.5 The Cache Safety Audit](#prompt-95--the-cache-safety-audit) | Use this prompt when a cache deployment is exhibiting thundering herd events, unexpected… |

---

## Prompt 9.1 — The Cache Domain Classification Audit

**When to use this:** Use this prompt before designing any cache layer, to classify each data type by freshness tolerance and assign the correct cache tier and TTL. Run it before any Redis cluster is provisioned or any CDN rule is written.

```text
Act as a Principal Caching Architect. I am designing a caching strategy
for the following data types in [Service Name]:

[For each data type, provide:]
- Data type name
- Current read frequency (reads/sec)
- Current write frequency (writes/sec)
- Number of distinct consumers reading this data
- Maximum acceptable staleness (user-facing)
- Whether the data is user-specific or shared across users
- Current database IOPS consumed by reads of this type

(1) For each data type, classify on the freshness spectrum:
    Zero tolerance / Seconds / Minutes / Hours / Days.
(2) For each data type with tolerance > zero, recommend:
    - Cache tier: Browser / CDN / Redis / Origin Shield
    - Cache strategy: Cache-aside / Write-through / Write-behind
    - TTL value derived from freshness tolerance (not from perf targets)
    - Invalidation trigger: TTL expiry / Event-driven / Manual purge
(3) Calculate projected cache hit rate for each data type at the
    recommended TTL, given current read and write frequencies.
(4) Calculate projected database IOPS reduction after implementing
    the recommended cache strategy.
(5) Flag any data type where caching would require cache invalidation
    faster than the read rate — these are caching anti-candidates.
```

## Prompt 9.2 — The Redis Configuration Audit

**When to use this:** Use this prompt when designing the Redis configuration for a new cache deployment, or when a production Redis cluster is showing degraded cache hit rates, unexpected evictions, or memory pressure at scale.

```text
Act as a Principal Caching Engineer specializing in Redis. I am
auditing the following Redis deployment for production correctness:

Redis version: [X]
Deployment type: [Single node / Sentinel / Cluster / Managed]
Configured maxmemory: [X GB]
Current memory utilization: [X%]
Current eviction policy: [policy name]
Cache hit rate (last 24h): [X%]
Key count: [N]
Average key TTL: [X seconds]
Eviction count (last 24h): [N]

Workload description:
- Primary use cases: [Cache-aside reads / Session / Rate limiting / Deduplication]
- Access pattern: [Uniform / Hot-key skewed / Long-tail]
- Write frequency: [X writes/sec]
- Read frequency: [X reads/sec]

(1) Evaluate whether the current eviction policy matches the workload.
    If eviction count is high and hit rate is declining, identify the
    eviction-hit-rate correlation and recommend the correct policy.
(2) Calculate the minimum memory required to maintain the target cache
    hit rate: (working set size) x (1 + overhead factor of 1.3).
(3) Identify any keys without TTL that are consuming memory permanently.
(4) If the deployment is single-node, evaluate whether sentinel or cluster
    mode is required for the current availability SLO.
(5) Define the fallback behavior: what happens to the application when
    Redis is unavailable? If the answer is 500 errors, flag as a
    single-point-of-failure design requiring immediate remediation.
```

## Prompt 9.3 — The CDN Configuration Audit

**When to use this:** Use this prompt when auditing an existing CDN configuration for security, performance, and availability gaps, or when designing CDN rules for a new global deployment.

```text
Act as a Principal Edge Architecture Engineer. I am auditing the following
CDN configuration for correctness:

CDN provider: [Cloudflare / CloudFront / Azure Front Door / other]
Origin regions: [list of regions serving as origin]
Content types served: [static assets / semi-static catalog / authenticated pages / API responses]
Current cache hit rate: [X%]
Origin shield configured: [Yes / No]
Traffic manager / health probe configured: [Yes / No]

I will provide:
1. The CDN cache rules / behaviors configuration.
2. The Cache-Control headers returned by the origin for each content type.
3. The origin health probe configuration (if any).

[Paste CDN config, response headers, health probe config]

(1) For each content type, identify whether the Cache-Control header
    correctly reflects the intended cache behavior: public, private,
    no-store, max-age, stale-while-revalidate.
(2) Identify any authenticated or permission-gated response that lacks
    Cache-Control: private, no-store. Flag as data exposure risk.
(3) Evaluate whether origin shielding is configured. If not, calculate
    the thundering herd risk: how many concurrent CDN edge nodes would
    send simultaneous cache miss requests to origin during a traffic spike?
(4) Evaluate the traffic manager / health probe configuration.
    If origin goes down in [region], where does traffic route?
(5) Define the stale-serve window for each content type: how long
    should the CDN serve cached content when origin is unavailable?
```

## Prompt 9.4 — The Cache Invalidation Design Review

**When to use this:** Use this prompt when designing the invalidation strategy for a new cache layer, or when auditing an existing cache that is producing staleness complaints or unexpected database load spikes after content updates.

```text
Act as a Principal Caching Architect. I am designing the invalidation
strategy for the following cache deployment:

Cache tiers: [Redis / CDN / Browser / combination]
Data types cached: [list with TTL and update frequency for each]
Write event source: [database trigger / application event / CDC]
Current invalidation mechanism: [TTL only / manual purge / event-driven / none]
Current staleness complaint rate: [X incidents/month]

(1) For each data type, evaluate whether the current TTL is derived from
    the domain freshness tolerance or from performance intuition.
    Flag any TTL set to a round number without documented justification.
(2) For each write operation that modifies cached data, identify whether
    a cache invalidation event is emitted. Flag any write path that
    does not emit an invalidation signal.
(3) Design an event-driven invalidation pipeline:
    - What event triggers invalidation?
    - What cache tiers must be invalidated simultaneously?
    - What is the maximum acceptable delay between write and invalidation?
(4) For any large-scale invalidation scenario (category rename, pricing
    bulk update), calculate the thundering herd risk:
    - How many keys are affected?
    - What is the concurrent miss rate if all keys expire simultaneously?
    - Design a batch invalidation strategy with jitter to bound the spike.
(5) Define the TTL as a safety net: even with event-driven invalidation,
    every key must have a TTL that bounds maximum staleness if the
    invalidation event is lost. What is the correct TTL for each data type?
```

## Prompt 9.5 — The Cache Safety Audit

**When to use this:** Use this prompt when a cache deployment is exhibiting thundering herd events, unexpected database IOPS spikes during traffic peaks, or staleness incidents after content updates.

```text
Act as a Principal Reliability Engineer specializing in cache safety.
I am diagnosing the following cache safety incident:

Incident description: [e.g. database IOPS spike to 300% during flash sale]
Cache tier affected: [Redis / CDN / Origin Shield]
Key type affected: [e.g. product catalog entries]
Current TTL: [X seconds]
Estimated concurrent requests at time of incident: [N]
Thundering herd defense currently in place: [None / TTL jitter / Mutex / Coalescing]

(1) Calculate the thundering herd magnitude: given the concurrent request
    count and the key TTL, how many simultaneous cache misses would occur
    at expiry? At what traffic volume does this become a database risk?
(2) Recommend the minimum thundering herd defense for this workload:
    - TTL jitter range: what +/- percentage prevents synchronized expiry?
    - Mutex lock: what is the acceptable wait time for lock waiters?
    - Request coalescing: is this a single-instance or multi-instance risk?
(3) Evaluate whether the current TTL is correct given the domain freshness
    tolerance. If TTL was shortened in response to staleness complaints,
    calculate the IOPS cost of the reduction.
(4) Design the cache warm-up protocol: which keys must be pre-populated
    before the next cache flush or deployment?
(5) Define the database IOPS floor: what is the minimum provisioned IOPS
    required to handle a complete cache failure (0% hit rate) for 5 minutes
    without SLO breach?
```
