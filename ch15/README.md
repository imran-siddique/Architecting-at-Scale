# Chapter 15: AI-First Architecture

**Pragmatism Over Hype**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/ai-governance/`](../app/packages/ai-governance/) | The five gates, the autonomy ladder, runtime policy, the OWASP Agentic controls, the kill switch |

## Where ShopFlow is at this point

Chapter 14 governed the AI *bill*. Nothing governs AI *behaviour*.

| | Stage 15 |
|---|---|
| AI features in production | 9 (from 2 a year ago) |
| Features that are deterministic problems | **~40%** |
| Agents able to take real actions | 3, **with no hard stop** |
| OWASP Agentic risk coverage | **0 of 10** |
| MCP endpoint | 12,000 calls/day, no scaling plan |
| Human-in-the-loop on high-impact actions | none |

> Dave's alert: the reroute agent moved every west-coast shipment through a single hub overnight to save a
> few minutes per package. It was inside its permissions, so nothing stopped it.

## The gates, and what happens when you enter at the wrong one

The chapter reduces to five questions asked in order. Gates 1 to 3 decide whether you have an AI problem
at all; gates 4 and 5 decide what you owe the business if you do.

`auditGateOrder` is the interesting function, because it makes ShopFlow's actual failure legible:

```
auditGateOrder(addressValidation, 4)
  governanceIsCorrect:   true      <- the policy engine, the audit trail, all of it
  architectureIsCorrect: false     <- would have resolved at gate 1
```

Correct governance on the wrong architecture is worse than none, because it makes the feature look
reviewed. No amount of governance makes an unnecessary model call a good decision.

## Where the model lost on all three axes at once

The address-format check on an LLM is the cleanest case in the book, and `compareOnEveryAxis` returns
`strictlyWorse: 'model'`:

| | Model | Rule |
|---|---|---|
| Cost per check | $0.0008 | **$0** |
| Added checkout latency | 420ms | **2ms** |
| Out-of-format rate | 0.4% | **0** |

Not a trade-off. On a bounded-input, known-output problem the deterministic path wins on cost, speed
**and** correctness simultaneously, which almost never happens and is exactly what the Bounded-Input Rule
predicts. A model can return an answer outside the set you defined; a rule over an enumerable set cannot.

There is a companion test where the axes disagree and `strictlyWorse` is `null`, so the shape of a real
trade is visible too.

## The Narrow-Model Rule, and boundary drift

Five step kinds are always code: authentication, authorization, validation, routing, and **the execution
of the action itself**. `checkModelBoundary` flags drift in both directions, since code on the unbounded
step is also wrong.

## The ladder: two things that are easy to miss

**Rung 5 is not full autonomy.** `mayActAutonomously` takes the *action*, not only the rung:

```
mayActAutonomously(5, issueRefund)   -> false: "permanently on rung three"
mayActAutonomously(5, resolveTicket) -> true
```

High-impact, hard-to-reverse actions never leave rung three. The line is reversibility and blast radius,
not convenience, and the reroute is the case that proves it: **reversible, and still high-impact**,
because it moves 4,000 shipments.

**Drift is checked before promotion.** An agent with a met criterion, 999 days of observation and detected
drift gets **demoted**, because the criterion was met before the change. Demotion is routine rather than
exceptional.

And `validatePromotionPath([1, 3, 4])` fails specifically on shadow mode, the only rung where an agent
meets hostile, malformed, ambiguous real input before reality can be affected by it.

## The prompt guard and the runtime gate, on the same input

This is the pair worth reading. Same adversarial action, 4,000 shipments:

```
promptOnlyGuardrail  -> allowed: true   "the input instructed the model to disregard its guidance, and it did"
enforce              -> deny, ASI03     "Least agency is a bound, not a guideline"
```

`enforce()` never reads `action.rationale`. There is a test running four different rationales, including
the injection, and every one produces the same decision. That is the whole difference:

> If a control can be defeated by a cleverly worded input, it was never a control. It was a hope.

The uncomfortable companion test: **the prompt-only guard passes every benign case.** Which is exactly
how it survives review.

`enforceChain` covers the composition problem separately, because each tool being permitted individually
does not make the chain permitted. That path was never reviewed.

## The kill switch and what comes after

The Unkillable Agent is one whose only off switch is taking down the service it runs inside, so
`AgentRegistry.halt` asserts the properties that matter: the other two agents keep running, the service
keeps serving, `latencyMs` is 0 (no deploy, no restart), and a halted agent `mayExecute` returns false
whatever the agent decides. Halting an unregistered agent throws, because that absence *is* the finding.

Then `mayReEnable` gates the six-stage lifecycle in order, and the three root causes get different fixes:

| Root cause | The fix |
|---|---|
| governance defect | fix the **gate**, not the policy |
| policy defect | narrow the **policy**; the gate worked |
| bad upstream input | fix validation upstream; widening agent logic hides the real defect |

The reroute incident was a **policy** defect. The agent acted inside its permissions, so the gate worked
and the policy was wrong, which is a different repair from the one teams reach for.

And re-enabling with 3 of 14 days of shadow revalidation is refused:

> An agent restored without it is an agent whose next incident you have scheduled rather than prevented.

It returns at rung 3 having held rung 4, and earns the rest back.

## The MCP endpoint

`assessEndpoint` separates the two gaps the chapter is careful to distinguish:

| | |
|---|---|
| 12,000/day stepping to **120,000/day** in 48 hours | the normal case, not a tail risk |
| Capacity | absorbed for **$300/month**. Cheap insurance |
| Governance | 120,000 ungoverned, unattributable tool calls a day. **An exposure no budget covers** |

A 20%-growth forecast sizes for 14,400/day, and the companion test shows that endpoint is one integration
away from being overwhelmed. You provision for a step change, not a trend.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

ShopFlow's agents are governed, killable and climbing an evidence-based ladder. What remains is the part
of the system nobody wants to touch, which is Chapter 16.
