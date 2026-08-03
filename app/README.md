# ShopFlow

The running example from *Architecting at Scale*, as one codebase that evolves across the book.

## How chapter states are represented

ShopFlow is in a different architectural state in every chapter, and those states are the point
of the book: each one is the consequence of the previous chapter's solution.

**The tree carries the union; tags mark each chapter's state.**

```bash
git tag --list 'ch*'      # the chapter states that exist so far
git checkout ch1-monolith
```

So `services/monolith` (Chapter 1) and `packages/cache` (Chapter 9) both live here, and the shared
infrastructure — the schema, the compose file — carries what every chapter needs so all of it
still runs against one database. Where a column or a service exists because of a specific chapter,
a comment says which.

A tree that only ever held one state would read more purely, but it means a reader on Chapter 9
cannot see the Chapter 1 pathology that chapter is arguing against. This way both are present and
the tags still recover any single state.

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
    cache/            Chapter 9 - cache-aside, herd defence, invalidation
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
