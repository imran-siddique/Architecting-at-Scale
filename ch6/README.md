# Chapter 6: Architecting Scalable Services

**Decomposition and API Design**

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 5 Architect's Prompts from this chapter |
| [`../app/packages/decomposition/`](../app/packages/decomposition/) | Seam signals, the extraction sequence, the Strangler Fig, contract compatibility |

## Where ShopFlow is at this point

Chapter 5 unblocked the front-end teams. They now ship daily into a back end that cannot.

| Metric | Stage 6 |
|--------|---------|
| Availability | 99.1%, declining |
| Cloud spend | $7,000/mo, up 27% month on month |
| Backend deployment success rate | **65%** |
| Average backend build time | **47 minutes** |
| Lock contention (Orders table) | **14 concurrent modules** |
| Panic Meter | 6/10 |

> *Frontend teams ship daily. The backend team is afraid to deploy.*

## The chapter's framework is a threshold, so it is computable

Most decomposition advice is a feeling. Chapter 6's is arithmetic, which means it belongs in code
rather than in a meeting.

### The Gravity Signal Rule

> Extract a service when three or more of the following are true: build time dominated by the
> module, test blast radius beyond its domain, deployment success below the organizational SLO,
> read/write scaling diverging materially from neighbours, or merge conflict density indicating
> sustained boundary violation. **A single signal is a data point. Three signals are a mandate.**

`assessModule` counts them. Two signals does not extract; crossing the third flips it. There are
tests for both sides of that boundary, because a threshold nobody tests is a threshold that drifts.

One detail worth noting: **divergent scaling cannot be assessed for a module in isolation.** Catalog
at 400:1 reads-to-writes is remarkable next to neighbours at 3:1 and unremarkable among peers at
400:1. So the comparison set is an input, and there is a test showing the same module assessed both
ways.

### The No-Signal Rule, which is the half that gets skipped

> A module with no active seam signal is not a service waiting to be born. It is a module doing its
> job. Extraction is a response to measured pain; in its absence, the correct architecture is the
> one you already have.

`planDecomposition` returns a `stay` list alongside the sequence. Reviews, wishlist and tax-tables
trip nothing and remain in the monolith. The chapter notes this is the only decision on its list
that is free.

### The Extraction Sequence Doctrine

Extract in descending order of pain, and **never leave the highest-pain module for last.** Orders
has the worst deploy success, the widest blast radius and the most merge conflicts, so it goes
first. There is a test asserting the worst module is never last, which is the failure mode the
doctrine exists to prevent: teams start with something easy to build confidence and leave the thing
that is actually hurting them until the end.

The pain score orders the sequence and deliberately does **not** decide membership. A very painful
module with two signals is still a module doing its job.

### The Service Count Rule

Four extractions plus the monolith gives **five**, computed from the signals rather than chosen.
That is how the Canon's "14 modules become 6 services" is arrived at rather than asserted, with
Reviews staying inside the Catalog context.

## The Strangler Fig refuses to exist without a deadline

The Time-Box Mandate: *"A migration without a completion constraint does not complete; it becomes a
permanent operational state."*

So `completeBy` is a **constructor argument**. A router that cannot state its Wave 3 date throws.
`assertNotPermanent()` then fails the build once the published date passes with routes outstanding.

That check fails on a **date** rather than on someone noticing, and that is the entire design. The
proxy works. There is never a day when leaving it becomes visibly wrong, which is exactly how the
Permanent Proxy anti-pattern happens.

## The Silent Breaking Change Rule

> A change is breaking if any consumer's behavior changes as a result, **regardless of whether the
> schema changed.**

Two claims are asserted here, and both contradict the usual shortcut:

**An invariant change is breaking with an identical schema.** `totalCents` going from
*always non-negative* to *may be negative for refunds* changes nothing in the shape. Every consumer
that relied on the old guarantee breaks, and no schema diff tool will tell you.

**An additive change breaks a strict deserializer.** "Additive is safe" holds only for tolerant
readers, and strict is the default in several languages. So `checkCompatibility` defaults to
`strict`, on the grounds that the conservative default fails a CI check rather than a customer.

The rule does not forbid breaking changes. It requires a version increment for them, so
`requiresVersionBump` is the finding that matters: breaking, and shipped without one.

## Also here

**The Verb Boundary anti-pattern** is cheap to detect and worth failing a design review over. A
Create Service, a Read Service and an Update Service are architecturally coherent and domain
incoherent: an Order's create, read and update share business rules, so every rule change touches
four services instead of one. Matching is on whole words rather than substrings, so `credentials`
does not trip it. A check that cries wolf teaches the team to ignore it.

## Running it

```bash
cd ../app
npm ci
npm test
```

## Where this goes next

The services exist and own their data. They now talk to each other over a network, synchronously,
on the checkout path. Chapter 7 is where that network becomes the bottleneck.
