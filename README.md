# Architecting at Scale

The companion repository for the book **Architecting at Scale** (Packt): the per-chapter code,
extended notes, and all 73 Architect's Prompts that go with the book.

[Get the published book at Packt](https://www.packtpub.com/en-in/product/architecting-at-scale-9781807420963) · [Run ShopFlow](app/README.md) · [Browse the prompts](PROMPTS.md)

## Start here

The runnable code lives in one TypeScript workspace under [`app/`](app/), with chapter
walkthroughs in `ch1/` through `ch16/`. From the repository root:

```bash
cd app
npm run verify
```

This installs the locked dependencies, builds the workspace, and runs the unit tests.
See the [ShopFlow setup guide](app/README.md#running-it) for Node requirements and optional
Redis integration tests. The Chapter 1 monolith deliberately contains the failure modes
the book investigates; it is a teaching system, not a production starter.

ShopFlow is the running example throughout the book: an online store for home and lifestyle goods
that begins as a monolith serving 100 orders a day and ends as a globally distributed, observable,
resilient, cost-governed, AI-augmented system that keeps changing safely. Every chapter solves the
problem the previous chapter's solution created; this repository holds the artifacts that go with
that journey.

## Layout

One folder per chapter, `ch1` through `ch16`:

| Path | What it holds |
|------|---------------|
| `chN/prompts.md` | The Architect's Prompts from that chapter, verbatim, each with the *When to use this* line |
| `chN/*.md` | Extended notes, the detail that did not fit on the page |
| `chN/README.md` | Chapter walkthrough, with links to its implementation and tests |
| [`app/`](app/) | Shared ShopFlow workspace containing the runnable chapter implementations |

And at the root:

| Path | What it holds |
|------|---------------|
| [`PROMPTS.md`](PROMPTS.md) | Index of all 73 Architect's Prompts across the book |

## Chapters

| Ch | Title | Prompts | Notes |
|----|-------|---------|-------|
| 1 | The Scalability Mindset - When and Why to Scale | [2](ch1/prompts.md) |  |
| 2 | Core Principles of Scalable Architecture | [3](ch2/prompts.md) |  |
| 3 | Security-First and Compliance-First Architecture | [4](ch3/prompts.md) |  |
| 4 | Scaling the Global Delivery Layer - Edge, CDNs, and Beyond | [4](ch4/prompts.md) |  |
| 5 | Scaling the Modern Web Application – State, Performance, and Micro-Frontends | [5](ch5/prompts.md) | 6 |
| 6 | Architecting Scalable Services – Decomposition and API Design | [5](ch6/prompts.md) |  |
| 7 | Scaling Service Infrastructure – Resilience, Mesh, and Compute | [5](ch7/prompts.md) |  |
| 8 | Event-Driven Scaling – Decoupling with Messaging | [5](ch8/prompts.md) |  |
| 9 | Caching Strategies – Faster and Cheaper Scaling | [5](ch9/prompts.md) |  |
| 10 | Scaling Data and Databases – Storage, Queries, and Beyond | [5](ch10/prompts.md) |  |
| 11 | Observability – Seeing and Understanding Your System | [5](ch11/prompts.md) |  |
| 12 | Resilience and High Availability – Designing for Failure | [5](ch12/prompts.md) |  |
| 13 | Performance Tuning and Capacity Planning | [5](ch13/prompts.md) |  |
| 14 | Cost Optimization and Efficiency (FinOps) | [5](ch14/prompts.md) |  |
| 15 | AI-First Architecture: Pragmatism Over Hype | [5](ch15/prompts.md) |  |
| 16 | Continuous Experimentation and the Future-Proof System | [5](ch16/prompts.md) |  |
## Using the prompts

Every prompt is reproduced exactly as it appears in the book. They are deliberately demanding: each
one asks for a decision with the reasoning attached, not a summary. Two things to do before you run
one:

1. **Replace every `[bracketed placeholder]`** with your own data: a module inventory, a telemetry
   series, a cost breakdown. The prompts are built to reason over real numbers, and they produce
   generic advice when given generic input.
2. **Check the *When to use this* line.** The prompts are diagnostic instruments, and reaching for
   the wrong one is how you get a confident answer to a question you did not have.

## The ShopFlow stack

The book uses specific technology so the trade-offs stay concrete. The table describes the
book's architecture; the repository includes executable models of those decisions, not a
complete deployment of every listed service. See [the code map](app/README.md#how-chapter-states-are-represented).

| Concern | Choice |
|---------|--------|
| Relational store | MySQL 8 (sharded by a fixed 1,024-bucket logical key from Chapter 10) |
| Cache | Redis (Chapter 9) |
| Search | Elasticsearch, fed by CDC (Chapter 10) |
| Object storage | S3-compatible, URL-only in the relational row (Chapter 10) |
| Messaging | Managed RabbitMQ, with Kafka as the measured migration target (Chapter 8) |
| Services | TypeScript / Node.js, six bounded contexts (Chapter 6) |
| Front end | React micro-frontends behind a shell (Chapter 5) |
| Observability | OpenTelemetry, traces, metrics, structured logs (Chapter 11) |
| Load testing | k6 (Chapter 2) |
| Agent governance | Runtime policy enforcement at a single chokepoint (Chapters 14–15) |

## Status

All 16 technical chapters have prompts and walkthroughs, with their implementations mapped
in [`app/README.md`](app/README.md). The 73-prompt index is complete; Chapter 5 also has six
standalone extended notes. Unit tests run without infrastructure. The separate Redis suite
requires a running Redis instance and also runs in CI.
