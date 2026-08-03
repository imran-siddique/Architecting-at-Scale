# Chapter 7: Scaling Service Infrastructure

**Resilience, Mesh, and Compute**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/resilience/`](../app/packages/resilience/) | Bounded retries, graduated circuit breaking, bulkheads, timeout hierarchy, load shedding |

## Where ShopFlow is at this point

Chapter 6 gave the teams independent services. Chapter 7 is the bill for the network between them.

| Metric | Stage 7 |
|--------|---------|
| Availability | 97.8%, flickering, three brown-outs last sprint |
| Cloud spend | $10,000/mo, inflated by redundant retry traffic |
| Error rate (checkout) | **4.2%**, against a 1% SLO |
| Retry storm events | **3 in 14 days** |
| Connection pool exhaustion | 2 this sprint |
| MTTR | 4 hours, manual diagnosis only |
| Panic Meter | 7/10 |

> *Services healthy in isolation. The network between them is not.*

**The detail that matters most: Pricing was never down. It was slow.** Everything below follows
from that one fact, and it is the reason resilience is not the same discipline as availability.

## The retry storm, as arithmetic

Chapter 7 states the rule flatly: *"A retry policy without exponential backoff, jitter, and a retry
budget is not a resilience mechanism. It is a load amplifier with a delay. All three controls are
required."*

`amplificationFactor` computes it, and the result is the incident:

| Policy | Load multiple on a struggling dependency |
|---|---|
| Naive, 3 attempts | **3.0x** |
| Backoff and jitter added, no budget | **3.0x** |
| Backoff, jitter and a 10% budget | **1.3x** |

The middle row is the finding worth carrying. **Backoff and jitter do not reduce the load, they
only spread it out in time.** The budget is the only one of the three that caps the total, and it is
the one most implementations omit. Pricing received three times its normal traffic at the precise
moment it could absorb least, which exhausted the shared connection pool and produced a 4.2% error
rate on a path whose dependency never actually failed.

Each of the three controls is individually disqualifying, and there is a test for each omission,
because "all three are required" is a claim that should fail a build rather than sit in a doc.

## The Idempotency Rule

> Reads retry freely. Non-idempotent writes without a deduplication key must not be retried:
> return the failure to the caller, because **a duplicate charge is a worse outcome than a failed
> one.**

`retry()` refuses at the boundary. A `capturePayment` with no idempotency key is attempted exactly
once and the failure is returned. Add a key and the same operation retries. There are tests for
both, showing the call count.

## Graduated circuit breaking, and the anti-pattern it exists for

The chapter gives exact thresholds, which is unusual and welcome: 10% errors sheds 25% of traffic,
25% errors sheds 50%, 50% opens the circuit. All three are asserted at the boundary.

The reason it is graduated rather than binary is the **Trigger-Happy Circuit Breaker**, which is a
real feedback loop and looks like the breaker working:

1. Thresholds are tight, so it opens on a transient blip
2. Traffic is cut, so the downstream service receives less load
3. Less load makes it look healthier, so the half-open probe succeeds
4. The circuit closes, full traffic returns, and it degrades again

Two defences are tested directly against those steps. A **minimum sample count** means 100% errors
across three requests changes nothing, which kills step 1. And **three consecutive successful
probes** are required to close, because one probe against a service receiving 10% of its normal load
proves nothing, which kills step 3. `isFlapping()` detects the cycle when it happens anyway.

## Bulkheads make the opening incident structurally impossible

The Bulkhead Mandate: every P0 path gets a dedicated pool that non-critical paths cannot consume.
The test saturates Pricing's five slots and asserts checkout still has all twenty. That is the whole
incident, prevented by configuration rather than by anyone's discipline.

Acquisition **rejects immediately rather than queueing**. An unbounded queue converts a saturated
pool into unbounded latency, which is exactly how a slow dependency becomes an outage instead of a
degradation.

## Two more checks worth having in CI

**The timeout hierarchy** must decrease from the outside in. An inverted timeout manufactures retry
storms on its own: the outer layer gives up and retries while the inner layer is still working, so
the original request keeps running and the retry piles on top. Nothing is cancelled and everything
is duplicated. Equal timeouts and insufficient margin are flagged too, not just inversions.

**Load shedding runs in reverse priority order**: P2 at 80% utilization, P1 at 90%, P0 only at 100%
and always with an alert, because shedding P0 means operating beyond the provisioned envelope. The
test that states the rule best: at 85% utilization, in the same instant under the same load,
checkout is served and recommendations are not.

## On the service mesh

The chapter's Mesh Justification Rule is why there is no mesh in this package: *adopt a mesh to
solve a named operational problem, not because it is a recognized best practice.* ShopFlow's named
problems at this stage are retry amplification and pool sharing, and both are solved by libraries in
the call path. The mesh earns its place later, when uniform mTLS across teams and percentage-based
traffic shifting are the requirement.

## Running it

```bash
cd ../app
npm ci
npm test
npm run verify    # what CI runs: npm ci && tsc --build && vitest run
```

## Where this goes next

The network is bounded and the brown-outs stop. Checkout is still a synchronous chain of six
services, so its latency is the sum of theirs and its availability is their product. Chapter 8
breaks the chain.
