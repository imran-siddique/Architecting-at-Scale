# Chapter 2: Core Principles of Scalable Architecture

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 3 Architect's Prompts from this chapter |
| [`../app/packages/platform/`](../app/packages/platform/) | Externalized session state and the correlation ID |

## Where ShopFlow is at this point

Chapter 1's answer was to scale the database tier up. It worked, and then it ran out.

| Metric | Stage 1 | Stage 2 |
|--------|---------|---------|
| Availability | 99.0% | 99.5%, degrading at peak |
| Cloud spend | $500/mo | **$2,500/mo** (5×) |
| Active connections | 450 / 500 | **4,800 / 5,000** |

> *"We bought the biggest server AWS sells, and we are sitting at 95% CPU. There is nowhere left to
> go up. If we get one more viral post, we go dark."*

Look at the connection ratio: 90% before, 96% now. Ten times the hardware bought headroom and
changed **nothing structural**. That is the finding, vertical scaling moves the wall without
removing it, and there is exactly one wall left to hit.

## The two things that must happen before horizontal scaling is possible

Neither is a performance fix. Both are preconditions.

### 1. Statelessness: and Figure 2.2 is executable

The chapter's Golden Rule: *a horizontally scalable service treats all incoming requests as
strangers.* Stated as mechanics rather than metaphor: every instance is stateless, and all state
lives in an external store.

[`test/statelessness.spec.ts`](../app/packages/platform/test/statelessness.spec.ts) runs both
halves of Figure 2.2 as a controlled experiment: identical fleet, identical traffic, identical
instance failure, differing **only** in where session state lives.

| | Sticky sessions | Shared session store |
|---|---|---|
| Kill one instance of four | carts destroyed for everyone pinned to it | **zero** sessions lost |
| One bot at 10× load | fleet lopsided, Server A pegged, Server B idle | balanced within 1.5× |

Both of the chapter's objections turn out to be consequences of the routing rule rather than
matters of taste, which is why they can be asserted instead of argued:

- **The Availability Trap.** Sticky routing sends a user to their instance whether it is alive or
  not. When it dies, their cart dies with it.
- **The Hot Node problem.** Sticky routing distributes by *user*, not by load. The load balancer is
  doing exactly what it was told and the fleet is still uneven.

`SessionStore` is the fix, and it is one method: read the session by ID, reuse it if present,
create and write it back only if absent. No instance holds the authoritative copy, so no instance
is special, so any instance can be lost. The test proves it by pointing two independently
constructed stores (two "servers") at one backend and reading a cart written by the other.

### 2. The correlation ID

The chapter calls this the one non-negotiable requirement of any distributed system. ShopFlow is
still a monolith, which is precisely why it goes in now: retrofitting it after decomposition means
retrofitting it across six services at once.

The rule is *generate at the edge, trust but verify*, and it has three cases:

| Inbound header | What happens |
|---|---|
| absent | the edge mints one |
| valid | preserved, so a client can trace end to end through its own systems |
| **malformed** | **regenerated**, never passed through, never merely sanitized |

The third case is the one that gets skipped, and it is the one that makes this a security control
rather than a convenience. The test suite fires eight hostile values at it: a 5,000-character
cardinality bomb, a newline-injected fake log entry, `DROP TABLE orders;--`, a path traversal. Every one is asserted to be replaced rather than cleaned up and kept. An ID taken from an untrusted client
and written into your logs is a log-injection vector and an index blow-up.

`outboundHeaders()` deliberately **throws** on an invalid ID rather than propagating it. A trace
that is quietly wrong is worse than one that is obviously broken, because it gets trusted.

## Running it

```bash
cd ../app
npm install
npm test          # both pillars, no infrastructure needed
npm run monolith  # correlation IDs now echo on every response
```

```bash
curl -i localhost:3000/health                                   # minted at the edge
curl -i -H 'x-correlation-id: bad' localhost:3000/health        # regenerated
curl -i -H "x-correlation-id: $(uuidgen)" localhost:3000/health # preserved
```

## What is deliberately still broken

The legacy search route still does its full table scan and still holds a connection for three
seconds. Chapter 2 does not fix it, and neither does this code. The chapter's own note is that
ShopFlow's first move is *not* to fix the slow search; it is to decouple session and cart from the
web server, because until you can move a user between instances without losing their basket you
cannot scale horizontally at all, and a faster query on one enormous box is still one box.

Chapter 1's tests already show what removing the hold would buy: the ceiling moves from ~166 req/s
to ~16,666 req/s on the same pool. Knowing that and not doing it yet is the sequencing the chapter
is arguing for.

## Where this goes next

Statelessness makes the fleet horizontally scalable and the correlation ID makes it debuggable.
Chapter 3 asks the question that follows immediately from having a fleet instead of a server: once
services talk to each other over a network, what is still allowed to trust what?
