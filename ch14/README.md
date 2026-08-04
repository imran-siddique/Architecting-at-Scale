# Chapter 14: Cost Optimization and Efficiency (FinOps)

**Governing the Bill You Already Have**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/finops/`](../app/packages/finops/) | Unit economics, the provisioned-once cadence, managed versus self-hosted, token governance |

## Where ShopFlow is at this point

Chapter 13 right-sized the infrastructure. Cost growth is still ungoverned: spend is traceable to a
service but not to a unit of business value, and the newest line items have no owner and no budget.

| | Stage 14 |
|---|---|
| Monthly spend | $9,535 |
| Untagged | **23%** (~$2,193) |
| Cost per order | $0.10 |
| Backup tier | $1,180, no owner, never reviewed |
| LLM tokens | $1,900, no owner, no budget |

## The metric that improves while the product gets worse

The Successful-Unit Rule gets the most test coverage here because it is the one that can silently
mislead. `unitCost` returns both denominators so the difference is visible:

```
same spend, same orders, twice the abandoned carts
  cost per ATTEMPTED unit   falls      <- looks like an improvement
  success rate              falls
  cost per SUCCESSFUL unit  unchanged  <- correctly does not move
```

There is a second test where the system gives up faster: half the spend, half the orders. Cost per
attempt improves and cost per success gets *worse*. A denominator that counts failures rewards a system
for failing cheaply.

## Why the spend alarm stayed quiet

The AI recommendation feature added ~$900/month to an $8,635 bill. `ceilingWouldCatch` is tested against
every plausible round-number ceiling from $5,000 to $15,000 and **none of them fires**: each one is
either already breached or not yet reached.

Cost per order went $0.091 → $0.100. A 10.4% rise against flat order growth, and that slope was the
only signal available.

## Tagging did not cut the bill

Worth separating, because conflating the two overstates the return by 3.5x:

| | |
|---|---|
| Reclassified by tagging | $2,193/month |
| Actually **recovered** | $620/month ($7,440/year) |

`tagggingReturn` reports them as different fields. Tagging converts unexaminable spend into attributable
spend; the saving is whatever the examination then finds.

## The backup audit's two guards

`auditBackups` will not drop geo-redundancy unless the data is **rebuildable from a backed-up source**,
and will not cut retention unless **nothing depends on the longer window**. There is a test running the
same tiers with both guards failing, and it recovers nothing.

Without those conditions this is not a cost rule, it is a procedure for deleting backups. The order
database keeps its geo-redundancy and its 35 days, which is why the recovery objective did not change.

## The managed-cache comparison has a horizon problem

The chapter's numbers: $1,400/month premium, $16,800/year, about **4.2 engineering weeks** at $4,000/week.
Self-hosting is 3 to 4 weeks to build plus 1 to 1.5 weeks a year of upkeep. The conclusion is *"the
premium is cheaper than the labor."*

| Horizon | Premium | Self-host | Cheaper on labor |
|---|---|---|---|
| 1 year | 4.2 weeks | 4.75 weeks | too close to call |
| 3 years | 12.6 weeks | 7.25 weeks | **self-hosted** |

The build cost does not recur. From year two the comparison is 1.25 weeks of upkeep against 4.2 weeks of
premium, every year, and `laborCrossoverYears` puts the flip at about **14 months**.

**The recommendation still stands, on the chapter's other reason.** The operational risk lands on the P0
path, and paying a premium to move a class of incident off checkout is sound whether or not it also
saves labor. `recommend()` returns `basis: 'operational-risk'` and says so explicitly, with a companion
test showing that the *same numbers* with the risk off the P0 path recommend self-hosting.

That separation is the point: a decision resting on risk survives the arithmetic changing. One resting
on the arithmetic does not.

## Token governance: three guards, three different failures

`runConversation` enforces all three, and each test isolates what its guard alone would miss:

| Guard | Bounds |
|---|---|
| the cascade | the cost of a **typical** request. 70% of conversations route to the cheap tier |
| the step cap | a reasoning loop. Without it the same request runs until the *budget* catches it |
| the budget | the **worst** case, the one that produced the $500/hour story |

Ungoverned, one looping conversation costs $30. Guarded, it is capped at $0.50, which is over **50x**.

Cost per resolved ticket falls by more than 60% with `resolved` identical at 98/100 in both runs, so the
quality claim is asserted rather than assumed.

And the arithmetic behind the per-call trap, as a one-line test:

```
PRICING.cheap * 50  >  PRICING.capable
```

A cheap model called fifty times costs more than an expensive model called once. The per-call price is
what vendors quote; the per-outcome cost is what lands on the bill.

## The chokepoint and the cascade's five signals

`auditChokepoint` returns `budgetEnforceable: false` on a single bypass, because one gap leaks the whole
budget. It is a structural property you can test for rather than something to notice in review.

`evaluateCascade` refuses a validation run on four of the five signals. Optimizing escalation rate,
quality, latency or tokens alone moves cost off the bill and onto the customer, which is why
`resolution-rate` is not optional. A vendor repricing a tier invalidates the thresholds **immediately**,
not at the next quarterly review.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

ShopFlow's bill is governed and its AI features have budgets. What it does not have is any way to tell
which of those AI features is doing real work, which is Chapter 15.
