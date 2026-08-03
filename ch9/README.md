# Chapter 9 — Caching Strategies

**Faster and Cheaper Scaling**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/cache/`](../app/packages/cache/) | The caching layer, with the tests that prove the chapter's claims |

## Where ShopFlow is at this point

Chapter 8 moved checkout onto an event-driven backbone and got the synchronous critical path from
2.1s down to under 300ms. That worked, and it created the next problem: **read amplification.**
Five inventory reads per order, read IOPS at 78% of provisioned capacity, and a Frankfurt catalog
p99 of 180ms. Nothing is broken. The database is simply being asked the same questions repeatedly.

This chapter puts a cache in front of it, and then spends most of its length on the part that
actually decides whether caching was a good idea: **invalidation.**

## The code

Everything lives in [`app/packages/cache`](../app/packages/cache/). Three files carry the chapter:

**`cache-aside.ts`** — the read path. Four defences, each bounding a different failure:

- *Single-flight* collapses concurrent identical misses in one process into one origin read
- *A distributed herd lock* does the same across the fleet, which single-flight cannot
- *TTL jitter* stops a batch written together from expiring together
- *Negative caching* stops a hammered absent key becoming a repeated table scan

The chapter's argument is that these are mandatory rather than optional, and the test suite is
where that gets tested — delete any one and a named test fails.

**`invalidation-consumer.ts`** — the listing from the chapter, built out. Chapter 8 established
that every mainstream broker is at-least-once, so this consumer assumes three things *will* happen:

| Assumption | The mechanism |
|------------|---------------|
| Duplicate delivery | An `NX` dedupe marker on the **event id** — not the entity id, or two legitimate writes to the same product would silently collapse into one |
| Out-of-order delivery | A version guard that drops a purge older than the cached entry |
| Loss | The TTL on every entry. This is the whole reason an entry without an expiry is refused |

It also emits **invalidation lag** as a first-class metric, because "how stale can this be?" is
unanswerable without it, and an unanswerable staleness question is how a cache stops being a
performance concern and becomes a correctness one.

**`keys.ts`** — every cache key in the system, constructed in one place. This is the chapter's
Tool Tax on Redis made concrete: Redis will happily accept `product:123`, `products:123` and
`catalog:product:123` as three unrelated keys, and you find out during an incident.

## Running it

```bash
cd ../app
npm install
npm test        # the claims, no infrastructure needed
```

For the Redis integration suite:

```bash
npm run infra:up
REDIS_URL=redis://127.0.0.1:6379 npx vitest run
```

## What is deliberately *not* cached

Worth stating, because it is the part readers skip. Real-time stock is not cached at any tier. The
chapter's Cache Candidacy Checklist rules it out: the cost of being wrong is a customer buying
something that does not exist, and no TTL is short enough to make that acceptable. Caching is a
decision about tolerable staleness, and for some data the tolerance is zero.

## Where this goes next

Chapter 9's caching absorbs the read amplification — read IOPS drops from 78% to 16%, Frankfurt
catalog p99 from 180ms to 12ms. The new bottleneck is on the other side of the ledger: **write
amplification**, at 3.1x volume with eleven indexes on every Orders insert. That is Chapter 10.
