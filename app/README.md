# ShopFlow

The running example from *Architecting at Scale*, as one codebase that evolves across the book.

**Current state: end of Chapter 1 — the monolith.** One process, one database, one deployable.
Availability 99.0%, 5,000 orders/day, 450 of 500 database connections in use, p99 latency 3.2s.

## Why one codebase instead of sixteen folders

The system is in a different architectural state in every chapter, and those states are the point
of the book: each is the consequence of the previous chapter's solution. A per-chapter copy loses
that — you get sixteen snapshots and no evolution. Here the history *is* the argument, and each
chapter's state is reachable by tag.

```bash
git tag --list 'ch*'      # the states that exist so far
git checkout ch1-monolith
```

The trade is that you check out a tag to see an earlier state. That is deliberate; the alternative
is sixteen codebases that drift apart.

## The code is deliberately not fixed ahead of the book

Chapter 1's search route does a full table scan, holds a connection for three seconds, and writes
unbounded stack traces to local disk. All of that is intentional and none of it should be repaired
in place. The commits are the narrative.

## Layout

```
app/
  services/
    monolith/         Chapter 1 - everything in one process
  packages/           extracted shared libraries (from Chapter 6 onward)
  workers/            queue consumers (from Chapter 8 onward)
  db/schema.sql       the relational schema at this chapter's state
  docker-compose.yml  the infrastructure this chapter actually needs
```

## Running it

The test suite needs nothing but Node 20+:

```bash
cd app
npm install
npm test          # no infrastructure required
npm run build     # typecheck + emit
```

Infrastructure is only needed to serve traffic:

```bash
npm run infra:up
npm run monolith
npm run infra:down
```

## What the tests are for

They are not coverage. Each names a claim the book makes and proves it, so you can change the
implementation and watch which argument breaks. At this stage:

| Test | The claim it proves |
|------|---------------------|
| `500 connections at a ~3s hold saturate at ~166 req/s` | The tipping point is derivable from Little's Law before you reach it, not discoverable only in production |
| `a 1.9x traffic increase produces a far-larger latency increase` | Figure 1.1's knee is real arithmetic, not a rhetorical curve |
| `past the tipping point the queue has no steady state` | Above capacity, wait time grows with the observation window. A slow system and a system with no equilibrium are different problems |
| `a leading-wildcard LIKE reads every row` | The scan is the mechanism: a B-tree is ordered by prefix and `'%oak%'` has none to seek on |
| `scan cost grows linearly with the table` | Nothing about the code changed; the data grew. This is what "worked fine for 100 users" means |
| `at 90% utilization the system is still "fine"` | The uncomfortable one. The dashboard looks healthy right at the edge, which is why headroom must be measured rather than watched |

## Conventions

- **TypeScript, strict, ESM.** `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on.
- **`npm test` runs with no infrastructure.** If proving the book's claims needed Docker, nobody
  would run the proof. Suites that need a real service skip themselves unless its URL is set.
- **Comments explain the *why*, and in this codebase often the why-it-is-wrong.** A file that
  contains a deliberate pathology says so, and points at the test that measures it.
