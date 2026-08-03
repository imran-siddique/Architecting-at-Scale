# Chapter 1 — The Scalability Mindset

**When and Why to Scale**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 2 Architect's Prompts from this chapter |
| [`../app/services/monolith/`](../app/services/monolith/) | ShopFlow as one deployable, with the pathologies the chapter diagnoses |

## Where ShopFlow starts

One process, one database, one deployable. It works.

| Metric | Stage 1 |
|--------|---------|
| Availability | 99.0% — stuttering, frequent brief outages |
| Total orders | 5,000/day |
| Active DB connections | **450 / 500** (90%) |
| p99 latency | **3.2s** |
| Cloud spend | $500/mo |
| Dave alert | *"I'm manually clearing logs every 4 hours just to keep the disk from filling up."* |

Nothing in this code would fail a review. That is the chapter's point — it is correct code with
a scaling property nobody measured.

## The code is deliberately not fixed

[`src/routes/search.ts`](../app/services/monolith/src/routes/search.ts) is the listing from the
chapter, kept intact:

```sql
SELECT * FROM products WHERE description LIKE '%oak%'
```

Do not repair it. The git history is the argument — Chapter 2 onward is where it gets fixed, and
a repository that starts from the fixed version teaches nothing about how systems actually arrive
at trouble.

## What the tests prove

Chapter 1 makes three claims that sound like intuition and are actually arithmetic. All three are
executable — `npm test` needs no database:

**The tipping point is knowable before you reach it.**
[`test/saturation.spec.ts`](../app/services/monolith/test/saturation.spec.ts) derives it from
Little's Law rather than guessing: sustainable throughput = pool size ÷ hold time = 500 ÷ 3s
= **~166 req/s**. The same law read backwards turns the snapshot's 450/500 connections into a
traffic figure of ~150 req/s, which is how "90% utilized" becomes actionable instead of merely
alarming.

**The knee is caused by burstiness, not by utilization alone.** This one was learned the hard
way — the first version of the suite modelled arrivals as perfectly evenly spaced and then
asserted a knee. CI failed it, correctly: a D/D/c queue has *exactly zero* queueing below 100%
utilization and unbounded queueing above it. A step function, no curve anywhere.

So the suite now contrasts two runs with an identical pool, an identical hold, and an identical
average arrival rate of 150 req/s — differing only in whether arrivals are evenly spaced or
independent. Smooth arrivals at 90% utilization: nobody queues at all. Bursty arrivals at the
same 90%: requests queue. Once arrivals clump, a clump can exceed the pool while the average
still looks comfortable, which is the whole reason **90% average utilization is not 10% of
headroom.** Past the tipping point the queue has no steady state at all — wait time grows with
however long you watch it, which is the difference between a slow system and a system without
equilibrium.

**The full table scan is the mechanism.**
[`test/full-table-scan.spec.ts`](../app/services/monolith/test/full-table-scan.spec.ts) counts
rows touched by both access paths over the same data. A leading-wildcard `LIKE` reads all 100,000
rows because a B-tree is ordered by prefix and `'%oak%'` has no prefix to seek on. The final test
closes the causal chain: rows read → query duration → connection held → pool exhausted.

The simulation is seeded, so every number above is reproducible and reviewable rather than a
one-off run someone reports.

## Running it

```bash
cd ../app
npm install
npm test                  # the three claims, no infrastructure needed
```

To serve traffic and reproduce Figure 1.1 for yourself:

```bash
npm run infra:up          # MySQL, capped at 500 connections
npm run monolith
k6 run services/monolith/load/hockey-stick.js
```

The k6 script walks the arrival rate up through the tipping point instead of hammering one fixed
rate, because the *shape* is the finding. Its threshold is deliberately set to the pre-incident
expectation so the run **fails** at saturation — a load test that passes while the system falls
over is a load test nobody trusts.

There is also `GET /internal/saturation?rps=150&holdMs=3000`, which computes the headroom from
observed traffic. It is the only instrumentation in the chapter, and it is the one thing here
worth copying into a real system today.

## The prompts

Both of Chapter 1's prompts have something real to work with in this codebase:

- **1.1 The Diagnosis** — correlate p99 spikes against lock waits. The search route is the
  culprit it should find.
- **1.2 The Zombie Hunter** — [`src/legacy/zombie-routes.ts`](../app/services/monolith/src/legacy/zombie-routes.ts)
  contains five dead endpoints, including a debug handler that echoes request headers (and
  therefore cookies) to anyone who asks, and an admin price override with no authorization
  because it was written when the endpoint was not routable from outside the office.

The cost of a zombie endpoint is not the dead code. It is that nobody can *prove* it is unused,
so every future refactor has to reason about it.

## Where this goes next

The chapter's answer is to scale up the **database tier** — the actual bottleneck — not to add app
servers, which would only put more pressure on the same 500 connections. That buys time and
nothing else. Chapter 2 removes the reason the connection is held for three seconds in the first
place, which moves the ceiling by two orders of magnitude without buying a single server.
