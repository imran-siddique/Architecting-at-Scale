# ShopFlow

The running example from *Architecting at Scale*, as one codebase that evolves across the book.

## How chapter states are represented

ShopFlow is in a different architectural state in every chapter, and those states are the point
of the book: each one is the consequence of the previous chapter's solution.

**The tree carries the union, and each chapter's code is named for its chapter.**

| Chapter | Where its code lives |
|---------|----------------------|
| 1: the monolith | `services/monolith` |
| 2: statelessness and correlation IDs | `packages/platform` |
| 3: Zero Trust | `packages/security` |
| 4: edge, CDN and steering | `packages/cache/src/edge` |
| 5: micro-frontends | `packages/shell` |
| 6: decomposition | `packages/decomposition` |
| 7: resilience | `packages/resilience` |
| 8: event-driven | `packages/messaging` |
| 10: data and databases | `packages/data` |
| 9: caching | `packages/cache` |
| 11: observability | `packages/observability` |
| 12: resilience and degradation | `packages/degradation/` |
| 13: performance and capacity | `packages/capacity/` |

Shared infrastructure (the schema, the compose file) carries what every chapter needs, so all of
it still runs against one database. Where a column or a service exists because of a specific
chapter, a comment says which.

A tree that only ever held one state would read more purely, but it means a reader on Chapter 9
cannot see the Chapter 1 pathology that chapter is arguing against. This way both are present.

> **On tags.** There are none yet, deliberately. Chapters were written as the manuscript was
> finished rather than in order, so the commit history is not in chapter order and a `ch1-monolith`
> tag would point at a tree that already contained Chapter 9. A tag series is worth adding once all
> sixteen states are in and can be laid down honestly. Until then, the table above is the map.

## The code is deliberately not fixed ahead of the book

Chapter 1's search route does a full table scan, holds a connection for three seconds, and writes
unbounded stack traces to local disk. None of it should be repaired in place. The commits and the
tests are the narrative; a repository that starts from the fixed version teaches nothing about
how systems actually arrive at trouble.

## Layout

```
app/
  services/
    monolith/         Chapter 1 - everything in one process, with the pathologies
  packages/
    platform/         Chapter 2 - session store, correlation ID
    security/         Chapter 3 - workload identity, default-deny policy
    shell/            Chapter 5 - error boundaries, event bus, budgets
    decomposition/    Chapter 6 - seam signals, Strangler Fig, contracts
    resilience/       Chapter 7 - retries, breakers, bulkheads, shedding
    messaging/        Chapter 8 - outbox, idempotency, critical path
    data/             Chapter 10 - shard buckets, read routing, indexes, RPO
    cache/            Chapter 4 (edge/) + Chapter 9 (Redis tier)
    observability/    Chapter 11 - journey success, tracing, alert hygiene
  packages/degradation/    # Ch12: classification, the correctness floor, chaos progression
  packages/capacity/       # Ch13: the Hardware-First Rule, contention, headroom, good enough
  workers/            queue consumers (Chapter 8 onward)
  db/schema.sql       the relational schema, union across chapters
  docker-compose.yml  MySQL (Ch1), RabbitMQ (Ch8), Redis (Ch9)
```

## Running it

The test suite needs nothing but Node 20+:

```bash
cd app
npm ci
npm test          # no infrastructure required
npm run build     # typecheck + emit
```

Before pushing, run the check CI runs, which is not the same thing as `npm test`:

```bash
npm run verify    # npm ci && tsc --build && vitest run
```

The difference matters. `npm test` reuses whatever is already in `node_modules`, so it passes
happily when the lockfile is out of sync with `package.json`. Adding a workspace package changes
the dependency graph, and only `npm ci` notices.

Infrastructure is only needed for the integration tests and to serve traffic:

```bash
npm run infra:up
REDIS_URL=redis://127.0.0.1:6379 npx vitest run   # adds the Redis integration suite
npm run monolith                                   # Chapter 1's service on :3000
npm run infra:down
```

## What the tests are for

They are not coverage. Each names a claim the book makes and proves it, so you can change the
implementation and watch which argument breaks.

**Chapter 13: performance and capacity**

| Test | The claim it proves |
|------|---------------------|
| `three of the five exits do not involve writing optimization code` | The default outcome of an honest performance review is usually to provision or accept. |
| `question 1 ends it. Meeting the SLO is not a performance problem` | It is a performance preference, competing with the feature backlog for the same weeks. |
| `an algorithm-bound bottleneck skips the economics entirely` | Hardware will not resolve a lock or a query plan at any price, so there is nothing to compare. |
| `the Resource-Bound Precondition is empirical, not a category judgement` | 1.41x throughput on 2x hardware is the signature of an O(n²) routine, not a CPU shortage. |
| `$20,000 / $800 is 25 months, which is MORE than two years` | The manuscript divides correctly and then calls the result "less than 2 years". |
| `month 25 is when the recurring option STOPS being cheaper, not a payback date` | Option A is recurring and Option B is one-time, so the direction of the claim is inverted. |
| `the recommendation is still right, because the rule is a TWELVE-month test` | $9,600 against $20,000. The rule is framed at 12 months so a 25-month crossover never needs interpreting. |
| `halving the P2 job (Option B) does NOT satisfy the Physical Separation Rule` | 85% to 43% leaves a P0 and a P2 on the same physical compute. The two options do not address the same problem. |
| `resource limits on a shared pool are not physical separation` | A P2 inside its limit still takes IOPS, cache lines and scheduler time from the P0 beside it. |
| `step 2 decides everything. Risen P0 traffic makes it capacity, not contention` | The step teams skip. Separation does not help a workload that needs more resource. |
| `co-location must be confirmed before optimizing anything` | Optimizing a workload that was never the neighbour is engineering time on the wrong thing. |
| `above 150% is paying for capacity nobody uses, and it is quantifiable` | 200 units against a 100-unit peak is $2,000/month of idle capacity, not a label. |
| `a consistent gap in EITHER direction invalidates the model` | Over-prediction buys idle capacity on a false premise just as under-prediction misses growth. |
| `documented and scripted is not enough. It must have been RUN` | A scaling procedure that has never been executed is one that will fail at the worst moment. |
| `the SMALLER percentage is the one worth doing` | Checkout at 67% is worth doing; the analytics batch at 33% is not. Percentage is a benchmark metric. |
| `the opportunity cost refuses to invent the other side of the comparison` | The value of the feature those weeks would buy is the product team's number, not the architect's. |
| `the chapter's loaded rate reconciles across all three Manager's Math blocks` | $5,000/week in all three, which usually does not hold across a chapter. |

**Chapter 12: resilience and degradation**

| Test | The claim it proves |
|------|---------------------|
| `a P0 with no documented degraded path is refused, not graded` | A priority without a plan is a label. Grading throws rather than recording it. |
| `every P0 must name its P0P0` | Checkout's P0 is completing the order; its P0P0 is capturing the payment intent. |
| `a fast wrong answer is not a degraded mode, it is a defect with better latency` | `payment-integrity` carries the same $42,000/hour as checkout and still cannot be graded. |
| `the impact number does not promote a floor capability to P0` | $999,999/hour and $1/hour both return `ungraded`. Impact is not what disqualifies it. |
| `the six mechanisms compose into a completed order under pricing failure` | Breaker, flag, cached pricing, payment intent, queue, acknowledgement, in that order. |
| `what matters is what did NOT happen` | Across every failure combination: nobody charged without an order, no invented price, no skipped audit. |
| `with no cached price it REFUSES rather than inventing one` | An invented price is worse than a lost sale. |
| `the P0P0 is the payment intent, and a lost queue releases it` | If the order cannot be recorded, the captured intent must not survive. |
| `priority ordering alone lets one consumer take the whole class` | Four P1 partners, identical request counts, one taking 90% of the budget. |
| `the Fair Share Rule weights by COST, not request count` | The greedy partner is inside any count-based quota and still consumes the class. |
| `you may not run at N+1 until every rung up to N has a clean record` | Six clean staging runs are the price of admission to the first production experiment. |
| `a run with customer impact resets the progression at that rung` | An experiment that causes an incident teaches the organization that chaos engineering causes incidents. |
| `every rung declares an abort condition and a hypothesis` | Without an abort condition it is not an experiment, it is an outage you scheduled. |
| `break-even is about a month, not "less than 2 days"` | 3 engineering days of build cost against $2,400/month. The claim fails at every loaded rate from $400 to $1,600/day. |

**Chapter 11: observability**

| Test | The claim it proves |
|------|---------------------|
| `infrastructure availability reads 100% while journeys are failing` | The gap is a property of what you measure, computed from the same request data |
| `these failures are invisible to infrastructure monitoring BY CONSTRUCTION` | Not oversight. A 200 that achieved nothing |
| `header-only propagation survives every SYNC hop and dies at the async one` | Where the 0.3% hid. Brokers strip headers |
| `a trace that stops is indistinguishable from a request that finished` | Why nothing alerted for so long |
| `the naive version passes any test that only exercises synchronous calls` | Which is exactly how it shipped |
| `which means 53 FULL-TIME ENGINEERS` | The unit conversion the manuscript's ROI was missing, off by an order of magnitude |
| `any intervention resets the count` | An automation that needed help has not run unattended |

**Chapter 1: the monolith**

| Test | The claim it proves |
|------|---------------------|
| `500 connections at a ~3s hold saturate at ~166 req/s` | The tipping point is derivable from Little's Law before you reach it |
| `with perfectly smooth arrivals at 90% utilization, nobody queues at all` | A D/D/c queue has no knee. This is the control case |
| `with realistic bursty arrivals at the SAME 90%, requests do queue` | The knee comes from **variability**, not utilization, which is why 90% average utilization is not 10% of headroom |
| `past the tipping point the queue has no steady state` | Wait time grows with the observation window. A slow system and a system with no equilibrium are different problems |
| `a leading-wildcard LIKE reads every row` | A B-tree is ordered by prefix, and `'%oak%'` has none to seek on |
| `scan cost grows linearly with the table` | Nothing about the code changed; the data grew |

**Chapter 3: Zero Trust**

| Test | The claim it proves |
|------|---------------------|
| `a token for a DIFFERENT service is refused` | The confused-deputy check. Without it, any service holding a token can replay it fleet-wide |
| `a tampered payload fails the signature` | The payload is readable; that was never the protection |
| `the verifier caps token lifetime` | A compromised issuer cannot extend your exposure window |
| `an unlisted call is DENIED` | Default deny, not logged-and-allowed |
| `adding a new service grants it nothing implicitly` | What makes Assume Breach tractable |
| `in the castle, one compromise reaches the ENTIRE fleet` | The perimeter model, measured rather than asserted |
| `in the hotel, the same compromise reaches only its grants` | ≤ 2 of 6 versus 100%. This is the return on the ~20ms mTLS cost |

**Chapter 10: data and databases**

| Test | The claim it proves |
|------|---------------------|
| `hash % shardCount remaps nearly EVERY row when a node is added` | 80.2% of rows move. The design defect the reviewer caught |
| `adding a node moves only the buckets handed to it` | 20.5% against a 20% theoretical floor |
| `a naive rebalance moves 2.5x more than it needs to` | 51%. My own first attempt, kept as a warning |
| `order history is IMPORTANT and still belongs on the replica` | The axis is read-your-writes, not importance |
| `three of the eleven are STRUCTURAL and never audit candidates` | Dropping `uq_orders_idempotency` reintroduces the Ch8 double charge |
| `the same topology still LOSES committed writes on a correlated failure` | "Zero RPO" is only true for a single-node failure |
| `real-time stock must NOT be served from the search index` | Same conclusion Chapter 9 reached about caching it |

**Chapter 8: event-driven**

| Test | The claim it proves |
|------|---------------------|
| `an attempt-number key produces a DIFFERENT value per retry` | Cause 1 of the double charge: dedup cannot work on a key that changes |
| `a non-atomic check lets CONCURRENT duplicates both through` | Cause 2, tested with the *correct* key, so fixing the key alone is shown to be insufficient |
| `when Redis loses the key, the unique constraint still prevents the charge` | Why Redis is a pre-check and the constraint is the guarantee |
| `releases the claim on a genuine failure` | The worse failure: holding it means the customer is never charged at all |
| `without the outbox, a crash between write and publish loses the event FOREVER` | The gap. No consumer retry helps, because nothing was published |
| `the relay can produce a DUPLICATE, which is why consumers need the key` | Where at-least-once comes from, and why Chapter 9 deduplicates |
| `a synchronous chain multiplies its dependencies availability` | The reliability half of decoupling, not just the latency half |

**Chapter 7: resilience**

| Test | The claim it proves |
|------|---------------------|
| `naive retries TRIPLE the load on a dependency that is merely slow` | The opening incident as arithmetic. Pricing was never down |
| `the retry BUDGET is the control that actually caps amplification` | Backoff and jitter only spread load in time. Only the budget reduces it |
| `a non-idempotent write with no dedup key must NOT be retried` | A duplicate charge is worse than a failed one |
| `at 10% errors it throttles 25%, not opens` | Before a circuit opens, it should slow down |
| `below the minimum sample count it does not react at all` | Kills step 1 of the Trigger-Happy feedback loop |
| `one successful probe does not close the circuit` | Kills step 3: a probe at 10% of normal load proves nothing |
| `a slow P2 dependency cannot consume the P0 pool` | The bulkhead makes the incident structurally impossible |
| `an inverted timeout is flagged` | It manufactures retry storms on its own |
| `at 85% utilization, checkout is served and recommendations are not` | Reverse priority shedding, stated as one assertion |

**Chapter 6: decomposition**

| Test | The claim it proves |
|------|---------------------|
| `a module with two signals is NOT extracted` | Three signals are a mandate; two is neither |
| `the No-Signal Rule keeps quiet modules in the monolith` | The half that gets skipped, and the only free decision on the list |
| `the highest-pain module is never last` | The failure the Extraction Sequence Doctrine exists to prevent |
| `a router cannot be constructed without a completion date` | The Time-Box Mandate as a constructor argument |
| `the Permanent Proxy check fails on a DATE` | The proxy works, so nobody ever notices. The deadline has to fail the build by itself |
| `an invariant change is breaking even when the schema is IDENTICAL` | The silent break no schema diff tool reports |
| `an additive change breaks a STRICT deserializer` | "Additive is safe" holds only for tolerant readers |

**Chapter 5: micro-frontends**

| Test | The claim it proves |
|------|---------------------|
| `the Critical Path Doctrine holds when EVERY enhancement fails at once` | The doctrine's actual wording, run as a CI check rather than trusted by inspection |
| `the doctrine check FAILS when the critical path depends on an enhancement` | The realistic regression: checkout wired to a recommendations widget |
| `publishing a function is REJECTED` | Events carry data, not behaviour. One callback through the bus and the isolation is gone |
| `a second owner for the same state is REFUSED` | The State Ownership Rule as an error, not a convention |
| `a regression is attributed to the team that caused it` | Attribution is the feature. This is what Dave could not produce |

**Chapter 4: the edge**

| Test | The claim it proves |
|------|---------------------|
| `50 PoPs missing simultaneously produce exactly ONE origin fetch` | The origin shield. Two tiers of collapse are needed (per-PoP and at the shield) and neither alone is sufficient |
| `when the origin is DOWN, a stale entry is served, not a 404` | Availability beats freshness, as mechanism rather than sentiment |
| `past the stale window it fails rather than lying forever` | Stale-while-revalidate is a *bounded* promise |
| `a region that buckles is caught at 1%` | Baby-step steering exposes 1% of requests to the failure |
| `the same failure under a 100% flip exposes EVERY request` | The same failure, two orders of magnitude apart |

**Chapter 9: caching**

| Test | The claim it proves |
|------|---------------------|
| `N concurrent misses produce exactly ONE origin read` | Single-flight bounds the thundering herd. Delete it and this reports 50 database reads at the moment a hot key expires |
| `a missing row is remembered` | Negative caching stops a hammered absent key becoming a table scan |
| `a purge carrying an older version is DROPPED` | The version guard is what makes invalidation safe under out-of-order delivery |
| `duplicate delivery purges exactly once` | The NX dedupe marker makes the consumer idempotent, because every mainstream broker is at-least-once |
| `a lost event is bounded by the TTL` | Nothing handles the message at all. The TTL is the only backstop, which is why an entry without one is refused |
| `setIfAbsent is atomic` (integration) | The distributed herd lock rests on this. An `EXISTS`-then-`SET` implementation passes every sequential test and fails this one |

## Conventions

- **TypeScript, strict, ESM.** `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on.
- **Ports, not clients.** The cache is written against `CacheStore` / `PurgeTarget`, so the tiering
  Chapter 9 requires (Redis, then the CDN, then the origin shield) stays explicit instead of being
  scattered as vendor calls through the read path.
- **`npm test` runs with no infrastructure.** If proving the book's claims needed Docker, nobody
  would run the proof. Suites needing a real service skip themselves unless its URL is set.
- **Simulations are seeded.** A queueing assertion only belongs in a test suite if it returns the
  same numbers on every machine.
- **Comments explain the *why*, and sometimes the why-it-is-wrong.** A file carrying a deliberate
  pathology says so and points at the test that measures it.
