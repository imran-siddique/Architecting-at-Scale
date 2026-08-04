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
| 14: FinOps and token governance | `packages/finops/` |
| 15: AI-first architecture | `packages/ai-governance/` |
| 16: continuous experimentation | `packages/experimentation/` |

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
    degradation/      Chapter 12 - classification, correctness floor, chaos rungs
    capacity/         Chapter 13 - Hardware-First Rule, contention, headroom
    finops/           Chapter 14 - unit economics, review cadence, token governance
    ai-governance/    Chapter 15 - intelligence gates, autonomy ladder, kill switch
    experimentation/  Chapter 16 - maturity stages, flag lifecycle, delivery fitness
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

**Chapter 15: AI-first architecture**

| Test | The claim it proves |
|------|---------------------|
| `bounded inputs with enumerable outputs stop at gate 1` | A model adds nothing to a problem whose answers you can already enumerate. |
| `a team that starts at gate 4 governs a model whose presence was never justified` | Correct governance on the wrong architecture is worse than none, because it makes the feature look reviewed. |
| `on a bounded-input, known-output problem the model loses on ALL THREE axes at once` | Cost, speed and correctness all favour the rule. Not a trade-off. |
| `the rule takes the out-of-format rate to zero, not merely lower` | A model can return an answer outside the set you defined; a rule over an enumerable set cannot. |
| `boundary drift is a model handling a step with exactly one correct answer` | Authentication, authorization, validation, routing and action execution are always code. |
| `an agent climbs on production traffic, never on a demo and never on a date` | Both hold the agent at its rung, whatever the criterion says. |
| `the ladder is bidirectional and demotion is routine` | Drift, a changed input distribution or a failed replay test each demote a rung. |
| `drift is checked BEFORE promotion, so a met criterion does not outrank it` | The criterion was met before the change, so promoting on it promotes on stale evidence. |
| `skipping shadow mode skips the only rung that tests against reality` | It is where the agent meets hostile, malformed, ambiguous input before reality can be affected. |
| `rung 5 does NOT mean full autonomy` | High-impact, hard-to-reverse actions remain permanently on rung three. |
| `the line is reversibility and blast radius, not convenience` | The reroute is reversible and still high-impact, because it moves 4,000 shipments. |
| `a control defeated by a cleverly worded input was never a control` | The prompt-only guard lets 4,000 shipments through on an injection. |
| `the runtime gate does not read the rationale, so no wording changes the outcome` | Four different rationales including the injection, one decision. |
| `the prompt-only guard happens to work when nobody is attacking it` | Which is exactly why it survives review. It passes every benign test. |
| `individually permitted tools do not make their composition permitted` | An undeclared tool chain is a path nobody reviewed. |
| `halting one agent must not halt the service or the other agents` | The Unkillable Agent's only off switch is taking down the service it runs inside. |
| `it is unbypassable. A halted agent cannot execute whatever it decides` | The gate is outside the agent, so compliance is not the agent's choice. |
| `the reroute incident was a POLICY defect, not a governance one` | The agent acted inside its permissions. The gate worked and the policy was wrong. |
| `re-enabling without shadow revalidation schedules the next incident` | 3 of 14 days is refused, and the agent returns at rung 3 having held rung 4. |
| `the capacity was cheap insurance and the governance gap was the real risk` | 120,000 calls/day absorbed for $300/month; 120,000 ungoverned calls is an exposure no budget covers. |
| `you provision for a step change, not a trend` | A 20%-growth forecast sizes for 14,400/day against a plausible 120,000. |
**Chapter 16: continuous experimentation**

| Test | The claim it proves |
|------|---------------------|
| `flags without a canary buy the ability to hide unfinished work and none of the ability to measure` | ShopFlow's exact position, and the row that explains the graveyard. |
| `stage 2 stalls because the forcing functions live downstream of it` | The canary ends the experiment and rollback makes acting cheap. Stopping at flags removes both. |
| `skipping a stage produces the appearance of the capability without the mechanism` | Architectural experiments without canaries or rollback is a name for something that is not happening. |
| `a flag with no expiry was never an experiment` | It was a permanent fork introduced by accident. |
| `an unowned flag is an unremovable flag` | Deleting it requires knowing why it exists and nobody is accountable for remembering. |
| `ownership attaches to the service, so it transfers when the service does` | The field records a service; there is no way to record an individual. |
| `the 2^n bound is not the number anyone pays` | 2^182 is about 6e54. The per-path figure is what inflates a one-line fix. |
| `the cost is the reasoning burden per path, and it is still enormous` | ~61 flags on the busiest path is over 10^18 combinations. |
| `a dozen time-boxed flags is a practice, not a graveyard` | The busiest path drops to 32 combinations. |
| `the cleanup is a sprint because most of it is deletion, not adjudication` | 150 mechanical, 20 needing a person. The decision was made when the expiry passed. |
| `green health metrics with bad delivery is not healthy, it is stagnant` | Four verdicts rather than two, so stagnant is distinguishable from unhealthy. |
| `deployment frequency is an OUTCOME, so it is the wrong thing to attack first` | A team at 22% failure and three weeks of lead time cannot deploy weekly by deciding to. |
| `the gap is in learning cycles, which is why shipping harder later does not close it` | 12 cycles a year against 52. A feature gap closes by shipping more; a learning gap does not. |
| `a predictable unit carries NO variance buffer, and that is the whole argument` | Dependable capacity equals mean capacity only when the standard deviation is zero. |
| `the tuned unit must be provisioned against its bad case, not its mean` | 1,400 rps with 320 of deviation is 872 you can count on. The faster unit needs more of them. |
| `variance is the dominant cost, roughly 7x the price-per-capacity difference` | $2,480/month against $360. The chapter's Manager's Math states this without numbers; these are the numbers. |
| `without a pre-stated condition the decision goes to whoever invested most effort` | Which is the opposite of deciding on evidence, so the outcome is undecidable rather than adjudicated. |
| `an experiment that validates the existing design is a SUCCESSFUL experiment` | It cost a canary instead of a migration. Recording it as a failure teaches the team not to run the cheap check. |
| `the machinery is what makes a bet reversible, not the change` | The same change is fast or careful depending on whether the team reached stage four. |
| `a control that assumes a careful operator is a convention, not a gate` | Chapter 15's runtime-versus-prompt distinction arriving one layer up. |

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

**Chapter 14: FinOps and token governance**

| Test | The claim it proves |
|------|---------------------|
| `cost per ATTEMPTED unit is the one metric that improves as the product gets worse` | Twice the abandoned carts, same orders: per-attempt cost falls, per-success cost correctly does not move. |
| `a denominator that counts failures rewards a system for failing cheaply` | Give up faster: half the spend, half the orders. Per-attempt improves, per-success gets worse. |
| `no round-number ceiling was set to catch it, so the alarm stayed quiet` | $8,635 to $9,535 fires no ceiling from $5,000 to $15,000. Only the slope is visible. |
| `total spend rising with flat unit cost is a larger business, not a problem` | The rule's other half, and the one that stops a cost review becoming a growth tax. |
| `tagging does not cut the bill. It exposes the waste hiding inside the untagged spend` | $2,193 reclassified, $620 recovered. Conflating them overstates the return by 3.5x. |
| `a resource with no interval is the default state, and it is the one the rule targets` | Backup, retention, replication, egress and idle endpoints are set with a default and forgotten. |
| `the two guards are what make the backup audit zero-risk` | Without rebuildable-from-source and no-dependency-on-the-window, this is a procedure for deleting backups. |
| `the recovery objective for the order database does not change` | The audit refuses the one tier whose data is not rebuildable from source. |
| `at three years the labor arithmetic clearly favours self-hosting` | 7.25 weeks against 12.6. The build cost does not recur; the premium does. |
| `the labor crossover is a little over a year, not never` | "The premium is cheaper than the labor" holds for about 14 months and then stops. |
| `the recommendation survives, but on the RISK argument rather than the cost one` | The premium buys the removal of a class of incident from the P0 path. The same numbers without that recommend self-hosting. |
| `one bypass makes the budget unenforceable` | A single raw model call leaks the entire budget through that gap. |
| `the step cap is what stops the reasoning loops, and the cascade alone would not` | Without the cap the same request runs until the budget catches it, at six times the cost. |
| `the budget bounds the worst case, which produced the $500/hour story` | One looping conversation: $30 ungoverned, capped at $0.50. Over 50x. |
| `cost per resolved ticket falls by about 60% with no drop in resolution` | 98 of 100 resolved in both runs, so the quality claim is asserted rather than assumed. |
| `a cheap model called fifty times costs more than an expensive model called once` | The per-call price is what vendors quote; the per-outcome cost is what lands on the bill. |
| `all five signals, because optimizing the first four moves cost onto the customer` | A cascade validated without resolution-rate is a cascade that got cheaper by answering worse. |
| `a vendor change invalidates the thresholds immediately, not at the next quarter` | Repricing or deprecating a tier is not something a quarterly cadence can absorb. |

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
