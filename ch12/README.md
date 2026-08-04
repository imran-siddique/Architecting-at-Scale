# Chapter 12: Resilience and High Availability

**Graceful Degradation Under Failure**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The Architect's Prompts from this chapter |
| [`../app/packages/degradation/`](../app/packages/degradation/) | Classification, the correctness floor, the composed degraded checkout, fair share, the chaos progression |

## Where ShopFlow is at this point

Chapter 11 closed the visibility gap. Silent failures are caught in under a minute, alerts are down to
40 an hour and all actionable, MTTR is under 15 minutes.

And ShopFlow still has no idea what it is supposed to *do* when something breaks. Every service has a
happy-path SLO. None has a documented degraded path. `coverageReport` is the executable form of that
gap: a capability graded P0 with no degraded behaviour throws, because a priority without a plan is
just a label.

## Classification is not the interesting part. The refusals are

Two things make the grading honest.

**The correctness floor.** Five capabilities are never graded, plus regulatory controls:
authentication, authorization, payment integrity, audit logging, and data-integrity constraints.
Degrading them does not produce a reduced service, it produces an incorrect one.

> A fast wrong answer is not a degraded mode. It is a defect with better latency.

`grade()` returns `ungraded` for these **regardless of impact**, and there is a test proving it:
`payment-integrity` carries the same $42,000/hour as checkout itself and still cannot be graded. The
impact number is not what disqualifies it.

**The P0P0.** Every P0 must name the one thing inside it that survives the P0 itself degrading.

| | |
|---|---|
| Checkout's P0 | complete the order |
| Checkout's P0P0 | **capture the payment intent** |

Because a customer who has been charged and has no order is a worse outcome than a customer who could
not order at all.

## The six mechanisms composing

`attemptCheckout` walks the chapter's degraded-checkout scenario. Under pricing failure:

| Step | |
|---|---|
| 1 | pricing breaker opens |
| 2 | dynamic-pricing flag disabled |
| 3 | cached pricing served |
| 4 | payment intent captured |
| 5 | order queued for fulfilment |
| 6 | customer acknowledged |

What matters is not that checkout survived. It is the assertion that runs across **every** failure
combination:

```
expect(r.chargedWithoutOrder).toBe(false);
expect(r.inventedPrice).toBe(false);
expect(r.auditWritten).toBe(true);
```

The correctness floor held while everything above it degraded. Two paths show the shape of that:

- **No cached price:** checkout is *refused*. An invented price is worse than a lost sale.
- **Queue unavailable:** the captured payment intent is **released**. If the order cannot be
  recorded, the intent must not survive; that is exactly the outcome the P0P0 exists to prevent.

## Priority is not fairness

A system with perfect priority ordering can still let one consumer eat an entire class, and every
other consumer in it experiences that as an outage they did nothing to cause.

Four P1 partners, **identical request counts**, one taking 90% of the class budget by cost.
`partner-a` is inside any count-based quota and still consumes the class, which is why the Fair Share
Rule weights by **cost**, not requests.

## The chaos progression

`mayRunAt` refuses to let you skip ahead. Every lower rung needs its clean production record first,
and a run with customer-visible impact resets the rung, because an experiment that causes an incident
teaches the organization that chaos engineering causes incidents and the programme ends.

| Rung | | Clean runs to advance |
|---|---|---|
| 1 | latency injection, staging | 3 |
| 2 | dependency failure, staging | 3 |
| 3 | pod kill of one instance, production | 5 |
| 4 | dependency latency at 5%, production | 5 |
| 5 | zone removal, production | terminal |

Six clean staging runs are the price of admission to the first production experiment.

Every rung carries a hypothesis and an abort condition, and `validateExperiment` will not accept one
without both:

> No abort condition means this is not an experiment, it is an outage you scheduled.

## The break-even that was wrong

The manuscript claims load shedding pays back in **less than 2 days** against $2,400/month of avoided
over-provisioning and about 3 engineering days to build.

Three engineering days is not free. `assessShedding` measures the payback against the build cost:

| | |
|---|---|
| Build cost, 3 days at a loaded rate | ~$2,400 |
| Break-even | about **1 month** |
| First-year net | **$26,400** |

There is a test running that across every plausible loaded rate from $400 to $1,600/day; the two-day
figure fails at all of them. The confusion is two denominators: two days is roughly how long the
savings take to equal one prevented outage. Break-even means against the build cost.

Correcting it does not weaken the case, which is the point. A one-month payback is an excellent
return. The original number was just not true.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

ShopFlow now degrades predictably and its correctness floor is defended. What it does not have is any
account of what all of this costs, or which of these mechanisms was worth building, which is
Chapter 13.
