# Chapter 8: Event-Driven Scaling

**Decoupling with Messaging**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/messaging/`](../app/packages/messaging/) | Outbox, idempotency, critical-path separation, broker fit |

## Where ShopFlow is at this point

| Metric | Stage 8 |
|--------|---------|
| Checkout critical path | **2.1s**, fully synchronous |
| Payment timeout rate | 3.2%, each holding a checkout thread for 3s |
| Carrier notification | 4.7s, inside the checkout thread |
| Confirmation email | 8 to 12s, user watching a processing screen |
| **Double-charge incidents** | **3 this month** |
| Message broker | None |

> *System is stable. Checkout is slow. Customers are noticing.*

## The double-charge bug had two independent causes

This is the most useful thing in the chapter, and it is easy to conflate the two. **Fixing either
one alone still charges the customer twice**, so both are tested separately.

### Cause 1: the key was wrong

An attempt-number-based key produces a different value on every retry. To the dedup store, retry 1
and retry 2 are different operations, because as far as the key is concerned they *are*.

```
brokenAttemptBasedKey(op, 1)  ->  o-1001_attempt_1
brokenAttemptBasedKey(op, 2)  ->  o-1001_attempt_2      different, so no dedup
paymentIdempotencyKey(op)     ->  o-1001_pi_77          stable across every retry
```

The key must identify the **operation**, not the delivery. So the stable key excludes the attempt
number, the timestamp and any request id. It also excludes the amount, which is a judgement worth
stating: including it would make a corrected amount look like a new operation.

### Cause 2: the check was not atomic

The chapter's **Optimistic Idempotency Key** anti-pattern. Even with a correct key, a check-then-act
sequence lets two concurrent deliveries both pass before either records anything.

The test for this uses the *correct* stable key deliberately, to show that fixing the key would not
have prevented it. Twenty concurrent deliveries against an atomic claim produce one capture and
nineteen suppressions.

## Why Redis is a pre-check and the constraint is the guarantee

The chapter is specific that the authoritative dedup record is a unique constraint in the
application database, committed in the same transaction as the business write, with Redis as a fast
pre-check only.

The test makes the reason concrete: **evict the Redis key and try again.** Eviction under memory
pressure, a failover with asynchronous replication, a flush during an incident are all ordinary
operational events, and a Redis-only design double charges on any of them. The constraint catches
what the pre-check lost.

There is a test for the opposite failure too, which is the worse one: on a *genuine* error the claim
is **released**, because holding it would make the redelivery look like a duplicate and the customer
would never be charged at all.

## The outbox, and the duplicate it deliberately creates

The gap is narrow and permanent. Write the order, then publish the event. If the process dies
between those two steps, the order exists and the event does not, **forever**. No consumer retry
helps, because nothing was ever published.

Three tests cover it: the loss without an outbox, the atomic commit with one, and a failed
transaction discarding the event so there is no orphan.

Then the test that ties the chapter to Chapter 9:

> **`the relay can produce a DUPLICATE, which is why consumers need the key`**

Publish succeeds, the relay dies before marking the row, the next poll publishes again. That is not
a flaw in the pattern. It is the *source* of at-least-once delivery, and therefore the reason
Chapter 9's invalidation consumer deduplicates and this chapter's payment capture does too.

`markPublished` is gated on broker acknowledgement rather than on the send returning. Marking first
would convert at-least-once into at-most-once, and losing an event is the exact failure the outbox
exists to prevent. Erring toward duplicates is the correct direction, because the consumers are
already built for them.

## Critical-path separation, with the reliability half

Only **three of seven** checkout steps are user-blocking. Moving the rest off the request path takes
the p99 from **2.1s to 500ms**, computed from the step latencies rather than asserted.

The half that gets less attention: **a synchronous chain multiplies its dependencies' availability.**
Seven steps at 99% to 99.99% each give under 98% for the chain; three steps give over 99.6%. Removing
work from the chain improves reliability, not just speed.

A note on the arithmetic, stated in the code: summing per-step p99s does not give the chain's p99,
since that would need every step to hit its own 99th percentile on the same request. The sum is a
worst-case bound, used here because it is the number that bounds the user's experience.

The **Synchronous-When-Blocking Rule** is the counterweight: making a blocking operation async does
not remove its latency, it relocates it to where the user cannot see it happening, and the failure
then surfaces after they have moved on.

## Broker fit

`recommendBroker` implements the Broker Fit Rule. ShopFlow's 800 msg/s with no replay requirement
gets managed AMQP, and the **migration triggers are returned as named, measurable signals** so the
decision is revisited on evidence rather than enthusiasm. That is the counter to the Kafka Default
anti-pattern, which is choosing Kafka because someone already knows it.

`findBrokerCoupling` catches Kafka primitives leaking into a consumer interface. That check is the
difference between a configuration change and a rewrite.

## Running it

```bash
cd ../app
npm ci
npm run verify
```

## Where this goes next

Checkout is under 300ms and the double charges stop. Every order now triggers five inventory reads
across the new event consumers, so read IOPS is up 4.2x. That is Chapter 9, whose consumer is
already in this repo and already assumes the at-least-once delivery this chapter introduces.
