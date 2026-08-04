# Chapter 13: Performance Tuning and Capacity Planning

**Knowing When Not To Optimize**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/capacity/`](../app/packages/capacity/) | The Hardware-First Rule, contention diagnosis, physical separation, the headroom band, good enough |

## Where ShopFlow is at this point

Chapter 12 made the degraded paths real. The resilience architecture works, and the bill went up 34%
with no corresponding revenue.

| Metric | Stage 13 |
|--------|----------|
| Monthly infrastructure | $12,800, up 34% since Ch10 |
| P0 node pool | $3,200 (justified) |
| P2 background processing | $4,100 (unreviewed) |
| Indexing job CPU | 85% of shared node capacity |
| Search p99 during indexing | **210ms** (normal 95ms) |
| Capacity planning | reactive only |

## The framework's most useful property is how often it says "do nothing"

`decide()` runs the four questions in order, and each one can end the exercise. There are five exits
and a test asserting that only two of them lead to writing optimization code:

| Exit | Writes code? |
|---|---|
| Meeting its SLO | no. This is a performance *preference* competing with the feature backlog |
| Algorithm-bound | yes, and the economics never get asked |
| 12-month hardware < engineering | no. Provision |
| 12-month hardware > engineering | yes |
| No hardware path at any price | yes, and not as an economic choice but as the only one |

The Resource-Bound Precondition is implemented as the **empirical** test rather than a category
lookup, because a team can misclassify a lock as a CPU problem and buy bigger boxes for a year:

```
confirmResourceBound({ capacityMultiple: 2, observedThroughputMultiple: 1.41 })  // not resource-bound
```

1.41 on double the hardware is the signature of an O(n²) routine. Doubling the box buys a 41% increase
in workable *n*, not 100%.

## The crossover figure the manuscript reads backwards

The Manager's Math block computes `$20,000 ÷ $800 = 25 months` and then says *"Option A pays back in
less than 2 years."* Two problems.

**25 months is more than two years.** The division is right; the sentence about it is not.

**The direction is inverted.** Option A (the dedicated node pool) is the *recurring* cost. Option B
(the optimization) is the *one-time* cost. So month 25 is not when Option A pays back, it is the month
Option A has cost more than Option B ever would. Nothing is being paid back. A meter is running.

`crossover()` returns the number with that reading attached, and the tests make the useful point:

> **The recommendation is still right**, because the Hardware-First Rule tests the **twelve**-month
> hardware cost ($9,600) against the engineering cost ($20,000). The rule is framed at 12 months
> precisely so a 25-month crossover never has to be interpreted.

## Option A and Option B are not comparable, which the dollar figures hide

This is the bigger finding, and it is easy to miss because the two options are presented side by side
with prices.

The Physical Separation Rule says P0 and P2 workloads must not share physical compute. Not logical
partitions. Not resource limits on the same node pool.

- **Option A** moves indexing to a dedicated pool. Satisfies the rule.
- **Option B** halves the indexing job's CPU, 85% → ~43%. Still a P0 and a P2 on the same physical
  compute. `checkPhysicalSeparation` returns the same violation, just with a smaller number in it, and
  43% of a shared node is plenty to move a p99.

So the two options do not address the same problem. Pricing them against each other implies they do.

## Diagnosing contention, and the step everyone skips

`diagnose()` runs the five steps and two of them are **refusals**:

| | |
|---|---|
| **Step 2** | Did P0 traffic also rise? If yes, this is capacity and separation will not help |
| Step 3 | One aligned occurrence is coincidence. Two or three before calling it |
| **Step 5** | Confirm co-location, or you are optimizing a workload that was never the neighbour |

For ShopFlow it resolves in minutes: p99 95ms → 210ms (**2.2x**), search traffic flat, window aligns
with the indexing schedule three times over, indexing measured at 85% leaving **15%** for P0.

Step 2 is the one that decides everything, and it is the one teams skip.

## The headroom band and model decay

Target band is **120 to 150%** of measured peak, and `assessHeadroom` quantifies the excess above the
ceiling rather than just labelling it: 200 units against a 100-unit peak is $2,000/month of capacity
nobody uses.

`assessModel` treats a consistent gap in **either** direction as invalidating, which is the part that
gets forgiven in practice. Under-prediction misses growth; over-prediction buys idle capacity on a
false premise. Both mean the assumptions moved.

And a scaling procedure needs more than documentation:

> Documented and scripted is not enough. `assessScalingReadiness` requires it to have been **run**,
> within 90 days, in under 15 minutes. A procedure that has never been executed is one that will fail
> at the worst moment.

## Good enough, where the smaller percentage wins

The chapter's two examples are chosen so the *less* valuable one has the larger percentage improvement:

| | | Worth doing? |
|---|---|---|
| checkout 900ms → 300ms | **67%** faster | **yes**, every millisecond perceptible |
| analytics 3h → 2h | 33% faster | no. A full hour saved, and nobody is waiting |
| search ranking 35ms → 20ms | 43% faster | no. Already inside its 50ms threshold, and 15ms is below the perceptibility floor |

The smaller percentage is the one worth doing, which is why percentage improvement is a benchmark
metric rather than a business one. The question is never how much faster it got.

`opportunityCost` deliberately **refuses to invent** the other side of the comparison. The value of an
imperceptible 15ms is zero; the value of the feature those three weeks would buy is the product team's
number to supply. There is a test asserting the refusal.

One quiet piece of good news: the chapter's loaded rate is **$5,000/week in all three** Manager's Math
blocks (4 weeks = $20,000, 3 weeks = $15,000, twice). There is a test pinning that, because rates
usually do not reconcile across a chapter.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

ShopFlow now knows which optimizations are worth doing and what its capacity plan is. What it does not
have is any account of where the bill actually comes from, which is Chapter 14.
