# Chapter 11: Observability

**Seeing and Understanding Your System**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/observability/`](../app/packages/observability/) | The journey-success gap, trace propagation, alert rationalization, the trust ladder |

## Where ShopFlow is at this point

Chapter 10 got availability to 99.9%. Every dashboard is green and some customers are not getting
their orders.

| Metric | Stage 11 |
|--------|----------|
| Infrastructure availability | 99.9% |
| **User-journey success** | **99.7%** |
| Silent-failure floor | **0.3%**, detected by chargeback |
| Alert volume | 400/hour, 10 to 15% actionable |
| Log volume | 50TB/day |
| MTTR | 4 hours |

## The gap is a property of what you measure

`assessHealth` computes both numbers **from the same request data**, which is the point. The 0.3%
are not a different system, they are the same requests viewed through a different question.

| Question | Answer |
|---|---|
| Did services respond? | 100% |
| Were responses 2xx? | 100% |
| Did the journey complete? | **99.7%** |

Those failures are invisible to infrastructure monitoring **by construction**, not by oversight. The
confirm step returned a 200 and achieved nothing. There is a companion test showing that a *visible*
failure moves both numbers, which is why that class never went undetected.

## Where the silent failure actually hid

This is the most useful thing in the chapter and it connects directly to Chapter 2.

The correlation ID was propagated by HTTP header. `propagate()` walks ShopFlow's seven checkout hops
and shows exactly what happens:

| Carrier | Result |
|---|---|
| Header only | survives hops 1 to 5, **dies at hop 6** |
| Header and payload | survives the broker, dies at the external hop |
| Payload plus an ID registry | survives all seven |

Hop 6 is the async boundary. Brokers, bridges and dead-letter requeues do not preserve headers they
were never asked to carry, so the trace simply stopped there.

Two tests make the consequence explicit:

**`a trace that stops is indistinguishable from a request that finished.`** Nothing alerted, because
from the tracing backend's point of view those journeys ended normally at hop 5.

**`the naive version passes any test that only exercises synchronous calls.`** Which is exactly how
it shipped. A suite of sync hops gives header-only propagation a clean bill of health.

## The alert arithmetic that was wrong

400 alerts an hour at 8 minutes each is **53 engineer-hours of triage per hour.**

The manuscript originally described the recovered portion of that as *"six engineers' full working
capacity"*. It is not. **53 engineer-hours per hour is 53 full-time engineers**, off by roughly an
order of magnitude, and `assessTriageLoad` returns `impliedFullTimeEngineers` specifically so the
unit conversion is impossible to skip.

The correct reading is that 53 engineer-hours per hour **is the finding**: the volume is
unprocessable, nobody is reading the alerts, and the 12% that are actionable are being ignored along
with the rest.

`recoveredCapacity` then measures against what the rotation actually loses, with the assumptions
stated inline so they can be substituted:

| | |
|---|---|
| Six engineers, ~5 on-call days each, ~3 triage hours per day | 90 engineer-hours/month lost |
| A 90% alert reduction returns | 81 hours, about **0.5 FTE** |
| Annual value | roughly **$90,000** |

Not the $480,000 to $600,000 the original figure implied.

## Two ratchets

**The Rationalization Ratchet** refuses a suppression without 30 days of evidence (a category quiet
for a week may be seasonal), refuses a second suppression in the same cycle (two at once means a
missed incident cannot be attributed to either), and refuses a category anyone actually acted on. It
is a ratchet because once a category is suppressed, the evidence that it mattered stops arriving, so
the gate has to be on the way in.

**The Automation Trust Ladder** requires each rung to run unattended for its full period before the
next is enabled, and **any intervention resets the count**, because an automation that needed help
has not run unattended. Rung 3 changes state, so it requires 90 days.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

The gap closes: silent failures detected in under 60 seconds instead of by chargeback, alerts down to
40 an hour and all actionable, MTTR under 15 minutes. ShopFlow can now see its failures and has no
defined behaviour for them. Every service has a happy-path SLO and none has a documented degraded
path, which is Chapter 12.
