# Chapter 16: Continuous Experimentation and the Future-Proof System

**The Wrong Kind of Calm**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/experimentation/`](../app/packages/experimentation/) | The maturity progression, flag lifecycle, delivery fitness, the predictable unit, future-proof boundaries |

## Where ShopFlow is at this point

Nothing is broken, and that is the problem.

| | Stage 16 |
|---|---|
| Deployment frequency | **1/month** (from 1/day at peak) |
| Change failure rate | **22%** |
| Lead time | **3+ weeks** for a one-line fix |
| Active feature flags | **180+**, most past any useful life |
| Since the architecture last moved | 7 months |
| Experiments running in production | **0** |
| Panic Meter | 2/10, which is the wrong kind of calm |

## Stage two is a trap with a mechanical cause

`capabilitiesAt(2)` returns the row that explains everything else in the chapter:

```
canShipDark:         true
canMeasureOnASlice:  false
```

Flags without a canary buy the ability to hide unfinished work and none of the ability to measure it.

`forcingFunctions(2)` goes further, and this is the part worth arguing: stage two is not where teams stall
because of weak discipline. **The forcing functions live downstream of it.** The canary produces the
measurement that ends an experiment and automated rollback makes acting on it cheap. A team that stops at
flags has removed its own forcing function, leaving an expiry date competing with a roadmap.

## Where the graveyard's cost actually is

The chapter is careful to say the line-of-code cost is negligible, and saying so is what makes the real
argument credible. `reasoningTax` follows that carefully, and reports two very different numbers:

| | |
|---|---|
| Theoretical bound, 182 flags | 2¹⁸² ≈ **6 × 10⁵⁴**. True, and useless |
| Flags gating the busiest path | ~61 |
| Combinations a developer reasons about on that path | **> 10¹⁸** |

The 2ⁿ figure is not the number anyone pays. The per-path figure is, and it is the one that inflates a
one-line fix to three weeks.

Cut to a dozen time-boxed flags and the worst path drops to **32 combinations**. That is the difference
between an experimentation practice and an untested combinatorial space.

## Why the cleanup is a sprint and not a quarter

`planCleanup` splits the graveyard by what the work actually is:

| | | |
|---|---|---|
| Keep | 12 | still active |
| **Mechanical deletion** | 150 | the decision was made when the expiry passed. This is deletion, not adjudication |
| **Needs a person** | 20 | 15 abandoned at 100% (dead branch in live code), 5 never rolled out (behaviour nobody has seen work) |

## Delivery metrics as fitness

`assessFitness` returns four verdicts, not two, so **stagnant** is distinguishable from unhealthy:

```
ShopFlow:  healthLooksGood: true,  deliveryLooksGood: false  ->  "stagnant"
```

> Every health metric reads green and the system cannot change safely. That is not healthy, it is stagnant,
> and it stays invisible until you measure the right thing.

**And the first metric to attack is not deployment frequency.** `firstMetricToAttack` returns
`changeFailureRate`, because frequency is an *outcome*: a team at 22% failure with a three-week lead time
cannot deploy weekly by deciding to. The failure rate is what makes people cautious, and caution is what
produced the release window.

On the competitor gap, `iterationGap(1, 4.33)` gives 12 cycles a year against 52, and the note carries the
part that matters:

> The gap is in learning cycles completed, not features shipped. A feature gap closes by shipping more; a
> learning gap does not.

## The arithmetic the chapter does not supply

The Predictability-Over-Peak block is the only Manager's Math in Chapters 12 to 16 with **no numbers in
it**. Its claim is right: the measurable win was not raw speed, it was the elimination of the
over-provisioning that unpredictability forces. That claim has a number, and `plan()` computes it.

If a unit's capacity varies, you provision against the bad case rather than the mean:

| | Tuned unit | Standard unit |
|---|---|---|
| Mean capacity | 1,400 rps | 1,000 rps |
| Std dev | 320 | **0** |
| **Dependable capacity (p5)** | **872 rps** | **1,000 rps** |
| Units for 8,000 rps | 10 | 8 |
| Monthly | $6,200 | **$3,360** |

The faster unit needs *more* of them. And a test separates the two effects, because two things push the
same way here:

| | |
|---|---|
| Cost of the **variance** | **$2,480/month** |
| Cost of being worse per unit of capacity ($0.443/rps vs $0.420) | $360/month |

Variance is about **7x** the price difference. That is the mechanism, quantified, and the rule is about
predictability rather than about instance size.

## Abandonment conditions

`decide()` refuses to rule at all when the condition was not stated before the experiment ran:

> Without a pre-stated condition the decision is made by whoever has invested the most effort, which is
> the opposite of deciding on evidence.

And it returns `validatedExistingDesign: true` when nothing regressed and the improvement simply did not
clear its bar:

> An experiment that validates the existing design is a **successful** experiment. It cost a canary instead
> of a migration, and recording it as a failure teaches the team not to run the cheap check.

A declared metric that was not measured returns `undecidable` rather than passing.

## The thread back through the book

`pace()` makes the Reversible-Bet Rule depend on the machinery rather than the change. **The same change**
is a fast bet or a careful one depending on whether the team reached stage four:

```
pace(change, hasAutomatedRollback: true)   -> fast
pace(change, hasAutomatedRollback: false)  -> careful: "reversible in principle and not in practice"
```

And `assessBoundary` is Chapter 15's runtime-versus-prompt distinction arriving one layer up. A control that
assumes a careful operator is a convention, not a gate:

> Build for the operator you cannot vet in advance: a new engineer, a senior one, or an autonomous agent.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## The end of the arc

Sixteen chapters, from a single-process monolith with a full table scan to a system that is observable,
resilient, cost-governed, AI-governed, and able to change itself safely. The last property is the one that
keeps the other fifteen from decaying.
