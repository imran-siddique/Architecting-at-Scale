# Chapter 4: Scaling the Global Delivery Layer

**Edge, CDNs and Traffic Steering**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 4 Architect's Prompts from this chapter |
| [`../app/packages/cache/src/edge/`](../app/packages/cache/src/edge/) | Origin shield, stale-while-revalidate, baby-step steering |

## Where ShopFlow is at this point

Chapter 3's Zero Trust work stopped the breach spreading. It also made everything slower.

| Metric | Stage 4 |
|--------|---------|
| Availability | 92.0%, intermittent, database straining under security overhead |
| TCP/TLS handshake latency | **300ms** global average, the cost of mTLS |
| Cloud spend | $4,500/mo, rising on inefficient origin fetches |
| Panic Meter | 7/10 |

> **The Signal:** technically secure, geographically failing. The "Single Straw" database is
> struggling with the overhead of our own shields.

The CFO's question, *why does "safe" feel so "slow"?*, is the honest one. Chapter 3 bought
segmentation and paid for it in per-hop latency, and Chapter 4 is where that bill comes due.

## Why the edge code lives in `packages/cache`

Chapter 4's origin shield and Chapter 9's thundering-herd defence are **the same mechanism at two
different tiers.** Rather than force a package per chapter, the edge tier went into
`packages/cache/src/edge/` alongside the Redis tier, and `OriginShield` reuses Chapter 9's
`SingleFlight` directly.

That reuse is the more useful observation than either chapter makes alone: the herd is not an edge
problem or a Redis problem, it is a property of **any tier that fronts a slower one.** Wherever
there is a fan-in, there has to be a collapse.

## What the tests prove

### The origin shield (Figure 4.1)

The chapter's scenario: 50,000 users hit a product drop, the edge entry expires at that exact
millisecond, and every request goes past the edge to the origin at once.

**Two tiers of collapse are required, and neither is sufficient alone.** 200 concurrent users on
one PoP collapse to a single upstream call; 50 PoPs missing simultaneously collapse to **exactly
one origin fetch.** Remove the per-PoP flight and each PoP hammers the shield; remove the shield
flight and each PoP hammers the origin.

### Availability beats freshness (the Golden Rule)

The chapter states it plainly: better a 60-second-old price than a 404. The test kills the origin
mid-flight and asserts a *different* PoP, one that never held a local copy, still serves the
stale value from the shield.

The companion test matters as much: **past the stale window, it fails rather than lying forever.**
Stale-while-revalidate is a bounded promise. Serving a price indefinitely is a different and worse
failure than serving an error, so the code will not do it.

### Baby-step steering (Figure 4.3)

The chapter's rule is 1% → 3% → 10% → 30%, never a 100% flip. The tests make the arithmetic that
justifies it explicit:

| | Requests exposed to the failure |
|---|---|
| Baby-step, region buckles at 1% | **1%** |
| Same failure, 100% flip | **100%** |

Same region, same failure, two orders of magnitude apart. The point of a small first step is not
that it is cautious; it is that it *bounds the number of people who experience the failure you are
looking for.*

Rollback goes to the last healthy rung rather than to zero, because rolling all the way back
discards the knowledge that 10% was fine, and during a real failover you still need somewhere to
send traffic.

## A pattern worth noticing early

`shiftTraffic` is structurally the same thing as Chapter 16's canary release. The safe-change
primitive appears here for regional failover, again in Chapter 16 for feature rollout, and again
for architectural experiments. Chapter 16's closing argument is that they were always one
mechanism; this is the first place it shows up.

## Running it

```bash
cd ../app
npm install
npm test          # no infrastructure needed
```

## What Chapter 4 does not fix

The origin is still a single straw. The shield reduces how often it is asked, which buys real
headroom, but every shield miss still lands on one database in one region, and that database still
runs Chapter 1's full table scan. Chapters 9 and 10 address the two halves of that.

## Where this goes next

The delivery layer is fast and the origin is protected. Chapter 5 turns to the thing the customer
actually renders: the front end, which is now a monolith of its own and the new constraint on how
fast the team can ship.
