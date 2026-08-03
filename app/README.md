# ShopFlow

The running example from *Architecting at Scale*, as one codebase that evolves across the book.

**Current state: end of Chapter 9 — caching.** ShopFlow is six decomposed services behind an
event-driven backbone, with a Redis cache absorbing the read amplification that Chapter 8's move
to async created. Elasticsearch, sharding, and the observability stack arrive in Chapters 10 and 11.

## Why one codebase instead of sixteen folders

The system is in a different architectural state in every chapter, and those states are the point
of the book: each one is the consequence of the previous chapter's solution. A per-chapter copy
loses that — you get sixteen snapshots and no evolution. Here the history *is* the argument, and
each chapter's state is reachable by tag.

The trade is that you have to check out a tag to see an earlier state. That is deliberate: the
alternative is sixteen codebases that drift apart.

## Layout

```
app/
  packages/
    cache/            Chapter 9 - cache-aside, herd defence, invalidation
  services/           one folder per bounded context (Chapter 6)
  workers/            queue consumers (Chapter 8)
  db/schema.sql       the relational schema at this chapter's state
  docker-compose.yml  MySQL 8, Redis 7, RabbitMQ
```

## Running it

The unit suite needs nothing but Node 20:

```bash
cd app
npm install
npm test          # unit tests - no infrastructure required
npm run build     # typecheck + emit
```

Infrastructure is only needed for the integration tests and for actually serving traffic:

```bash
npm run infra:up
REDIS_URL=redis://127.0.0.1:6379 npx vitest run   # includes the Redis integration suite
npm run infra:down
```

## What the tests are for

They are not coverage. Each one names a claim the book makes and proves it, so you can change the
implementation and watch which argument breaks. The interesting ones:

| Test | The claim it proves |
|------|---------------------|
| `N concurrent misses produce exactly ONE origin read` | Single-flight bounds the thundering herd. Delete it and this test reports 50 database reads at the moment a hot key expires. |
| `a missing row is remembered` | Negative caching stops a hammered absent key becoming a table scan. |
| `a purge carrying an older version is DROPPED` | The version guard is what makes invalidation safe under out-of-order delivery. |
| `duplicate delivery purges exactly once` | The NX dedupe marker makes the consumer idempotent, because every mainstream broker is at-least-once (Chapter 8). |
| `a lost event is bounded by the TTL` | Nothing handles the message at all. The TTL is the only backstop — which is why an entry without one is refused. |
| `setIfAbsent is atomic` (integration) | The distributed herd lock rests on this. An `EXISTS`-then-`SET` implementation passes every sequential test and fails this one. |

## Chapter 9 in three files

- **`packages/cache/src/cache-aside.ts`** — the read path, with all four defences: single-flight,
  the cross-process herd lock, TTL jitter, and negative caching. Each bounds a different failure;
  removing any one reintroduces a specific outage.
- **`packages/cache/src/invalidation-consumer.ts`** — the listing from the chapter, built out.
  Assumes duplicate delivery, reordering, and loss will happen rather than that they might.
- **`packages/cache/src/keys.ts`** — every cache key in the system, in one place. Chapter 9's Tool
  Tax on Redis is the field-name contract the store does not enforce; this is where it lives instead.

## Conventions

- **TypeScript, strict, ESM.** `verbatimModuleSyntax` and `noUncheckedIndexedAccess` are on.
- **Ports, not clients.** The cache is written against `CacheStore` / `PurgeTarget`, so the tiering
  Chapter 9 requires (Redis, then the CDN, then the origin shield) stays explicit instead of being
  scattered as vendor calls through the read path.
- **`npm test` runs with no infrastructure.** If proving the book's claims needed Docker, nobody
  would run the proof. Integration tests skip themselves unless `REDIS_URL` is set.
