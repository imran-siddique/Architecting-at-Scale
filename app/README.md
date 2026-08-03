# ShopFlow

The running example from *Architecting at Scale*, as one codebase that evolves across the book.

## How chapter states are represented

ShopFlow is in a different architectural state in every chapter, and those states are the point
of the book: each one is the consequence of the previous chapter's solution.

**The tree carries the union, and each chapter's code is named for its chapter.**

| Chapter | Where its code lives |
|---------|----------------------|
| 1 — the monolith | `services/monolith` |
| 2 — statelessness, correlation IDs | `packages/platform` |
| 3 — Zero Trust | `packages/security` |
| 4 — edge, CDN, steering | `packages/cache/src/edge` |
| 9 — caching | `packages/cache` |

Shared infrastructure — the schema, the compose file — carries what every chapter needs, so all of
it still runs against one database. Where a column or a service exists because of a specific
chapter, a comment says which.

A tree that only ever held one state would read more purely, but it means a reader on Chapter 9
cannot see the Chapter 1 pathology that chapter is arguing against. This way both are present.

> **On tags.** There are none yet, deliberately. Chapters were written as the manuscript was
> finished rather than in order, so the commit history is not in chapter order and a `ch1-monolith`
> tag would point at a tree that already contained Chapter 9. A tag series is worth adding once all
> sixteen states are in and can be laid down honestly — until then, the table above is the map.

## The code is deliberately not fixed ahead of the book

Chapter 1's search route does a full table scan, holds a connection for three seconds, and writes
unbounded stack traces to local disk. None of it should be repaired in place. The commits and the
tests are the narrative — a repository that starts from the fixed version teaches nothing about
how systems actually arrive at trouble.

## Layout

```
app/
  services/
    monolith/         Chapter 1 - everything in one process, with the pathologies
  packages/
    platform/         Chapter 2 - session store, correlation ID
    security/         Chapter 3 - workload identity, default-deny policy
    cache/            Chapter 4 (edge/) + Chapter 9 (Redis tier)
  workers/            queue consumers (Chapter 8 onward)
  db/schema.sql       the relational schema, union across chapters
  docker-compose.yml  MySQL (Ch1), RabbitMQ (Ch8), Redis (Ch9)
```

## Running it

The test suite needs nothing but Node 20+:

```bash
cd app
npm install
npm test          # no infrastructure required
npm run build     # typecheck + emit
```

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

**Chapter 1 — the monolith**

| Test | The claim it proves |
|------|---------------------|
| `500 connections at a ~3s hold saturate at ~166 req/s` | The tipping point is derivable from Little's Law before you reach it |
| `with perfectly smooth arrivals at 90% utilization, nobody queues at all` | A D/D/c queue has no knee. This is the control case |
| `with realistic bursty arrivals at the SAME 90%, requests do queue` | The knee comes from **variability**, not utilization — which is why 90% average utilization is not 10% of headroom |
| `past the tipping point the queue has no steady state` | Wait time grows with the observation window. A slow system and a system with no equilibrium are different problems |
| `a leading-wildcard LIKE reads every row` | A B-tree is ordered by prefix, and `'%oak%'` has none to seek on |
| `scan cost grows linearly with the table` | Nothing about the code changed; the data grew |

**Chapter 3 — Zero Trust**

| Test | The claim it proves |
|------|---------------------|
| `a token for a DIFFERENT service is refused` | The confused-deputy check. Without it, any service holding a token can replay it fleet-wide |
| `a tampered payload fails the signature` | The payload is readable; that was never the protection |
| `the verifier caps token lifetime` | A compromised issuer cannot extend your exposure window |
| `an unlisted call is DENIED` | Default deny, not logged-and-allowed |
| `adding a new service grants it nothing implicitly` | What makes Assume Breach tractable |
| `in the castle, one compromise reaches the ENTIRE fleet` | The perimeter model, measured rather than asserted |
| `in the hotel, the same compromise reaches only its grants` | ≤ 2 of 6 versus 100%. This is the return on the ~20ms mTLS cost |

**Chapter 4 — the edge**

| Test | The claim it proves |
|------|---------------------|
| `50 PoPs missing simultaneously produce exactly ONE origin fetch` | The origin shield. Two tiers of collapse are needed — per-PoP and at the shield — and neither is sufficient alone |
| `when the origin is DOWN, a stale entry is served — not a 404` | Availability beats freshness, as mechanism rather than sentiment |
| `past the stale window it fails rather than lying forever` | Stale-while-revalidate is a *bounded* promise |
| `a region that buckles is caught at 1%` | Baby-step steering exposes 1% of requests to the failure |
| `the same failure under a 100% flip exposes EVERY request` | The same failure, two orders of magnitude apart |

**Chapter 9 — caching**

| Test | The claim it proves |
|------|---------------------|
| `N concurrent misses produce exactly ONE origin read` | Single-flight bounds the thundering herd. Delete it and this reports 50 database reads at the moment a hot key expires |
| `a missing row is remembered` | Negative caching stops a hammered absent key becoming a table scan |
| `a purge carrying an older version is DROPPED` | The version guard is what makes invalidation safe under out-of-order delivery |
| `duplicate delivery purges exactly once` | The NX dedupe marker makes the consumer idempotent, because every mainstream broker is at-least-once |
| `a lost event is bounded by the TTL` | Nothing handles the message at all. The TTL is the only backstop — which is why an entry without one is refused |
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
