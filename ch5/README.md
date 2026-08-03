# Chapter 5: Scaling the Modern Web Application

**State, Performance, and Micro-Frontends**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/shell/`](../app/packages/shell/) | Error boundary isolation, the event bus, state ownership, performance budgets |

Extended notes, written before the code and still the best prose explanation of each idea:

| | |
|---|---|
| [Rendering Strategies](Rendering%20Strategies.md) | CSR, SSR, SSG and ISR compared |
| [Shell Architecture](#) *(see Event Bus)* | What belongs in the Shell versus each micro-app |
| [Event Bus](Event%20Bus.md) | Cross-app communication without coupling |
| [Error Boundaries](Error%20Boundaries.md) | Isolating a crash to one micro-app |
| [Feature Flags](Feature%20Flags.md) | The kill switch and the experiment |
| [Main Thread Budget](Main%20Thread%20Budget.md) | Where the 2.8s goes |
| [Client Side Inference](Client%20Side%20Inference.md) | When to run a model in the browser |

## Where ShopFlow is at this point

The back end is fine. That is the problem.

| Metric | Stage 5 |
|--------|---------|
| Availability | 99.5%, stable |
| Main thread blocking | **2.8s** |
| Bundle size (gzipped) | **5.2MB** |
| LCP | 4.1s, failing Core Web Vitals |
| Team velocity | **1 deploy/week**, down from 1/day |
| Cross-team merge conflicts | 14/sprint |
| Panic Meter | 8/10, holiday sale in 72 hours |

> *"I can't even tell you which team's code caused the regression. It's all one giant bundle. We
> rolled back everything because we couldn't roll back anything."*

The constraint has moved from the infrastructure to the **organization**. Chapter 5's Monolith
Velocity Rule names the test: if adding an engineer does not proportionally increase deployment
frequency, the architecture is the bottleneck.

## What the code adds to the notes

The six notes above explain these ideas well. What the code adds is **enforcement**, because every
one of these rules degrades quietly when it is only written down.

### The Critical Path Doctrine, as a CI check

The doctrine's wording is precise: the page must render and function even if **every** enhancement
component fails simultaneously. Not one of them. All of them.

`Shell.assertCriticalPathSurvivesTotalEnhancementFailure()` builds the shell, replaces every
enhancement's `render` with a throw, and asserts the critical path still rendered. Worth running in
CI rather than trusting by inspection, because the realistic regression is someone wiring checkout
to a recommendations widget. That looks harmless in review and is invisible until the widget is
down. There is a test asserting the check **fails** in exactly that case.

The shell also refuses to register an enhancement with no fallback. A missing fallback is invisible
until the crash it was meant to cover.

### Events carry data, not behaviour

The note states the constraint. The code enforces it: **publishing a function throws**, and the
error names the path (`payload.a.b.c`) so the offending field is obvious.

This matters because the failure is gradual. The moment one team ships a callback through the bus,
the bus has become a coupling mechanism and the isolation is gone, and nobody notices the first
instance. Cycles and symbols are refused for the same reason.

Delivered payloads are frozen, so one micro-app cannot mutate another's fact.

### State ownership, enforced at claim time

The rule says every piece of state has exactly one owner, and that shared data is a service with
its own fallback rather than something "global". `StateRegistry.claim()` **refuses a second owner**,
which converts the rule into an error at the moment two teams would otherwise both reach for the
same key. Neither of them would be wrong, and the coupling would be created by accident.

Re-claiming by the same owner is idempotent. Reading state with no registered owner throws rather
than inventing a default.

### Budgets that name a team

Dave's complaint is about attribution, not size. `checkBudgets` reports **which team** owns each
regression, and follows the chapter's Budget Visibility Rule by separating `over` (report it, review
weekly) from `breaching` (fail the build, default at a 2x doubling).

A measurement for an unregistered micro-app throws, because an app with no budget has no owner, and
that is the monolith problem returning through the side door.

## Running it

```bash
cd ../app
npm install
npm test
```

No browser and no jsdom. The bus is written against an injectable `EventTarget`, so it runs in Node
directly, and the shell's render model is plain functions.

## Where this goes next

The front end is decomposed and the teams can ship independently again. Six micro-apps now call the
back end directly, which is the condition the chapter's BFF Mandate describes: three or more
front ends calling three or more services means the aggregation layer is no longer optional. That
pressure lands on the back end in Chapter 6, where the 14-module monolith becomes six services.
