# Chapter 4 — Architect's Prompts

**Scaling the Global Delivery Layer - Edge, CDNs, and Beyond**

The Architect's Prompts from Chapter 4, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**4 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [4.2 The Cache Policy Audit](#prompt-42--the-cache-policy-audit) | When deciding what to push to the edge and you need to separate safely-cacheable content… |
| [4.3 The Consistency Model Selector](#prompt-43--the-consistency-model-selector) | When choosing a consistency model for a specific data type and you want the trade-off made… |
| [4.4 The Protocol Readiness Check](#prompt-44--the-protocol-readiness-check) | Before enabling HTTP/3 in production, to confirm the upgrade will actually help and won't… |
| [4.1 The Edge Logic Migration](#prompt-41--the-edge-logic-migration) | Use this during your Pre-Migration Performance Audit to identify which high-latency… |

---

## Prompt 4.2 — The Cache Policy Audit

**When to use this:** When deciding what to push to the edge and you need to separate safely-cacheable content from must-be-fresh content before configuring the CDN.

```text
Act as a CDN architect. Here are my application's routes and the data each returns. Classify each as static/cacheable, cacheable-with-short-TTL, or never-cache, with a one-line reason. Flag any route that mixes personalized and public data in one response and suggest how to split it so the public shell can still be cached."




Anti-Pattern: The Zombie Edge:
Scaling by subtraction applies to the Edge just as much as the core. A common failure is treating the Edge as a dumping ground for legacy redirects and "temporary" geography-based logic. Every line of code running at the Edge adds Transitive Weight to the request. If you don't prune unused Edge functions, you aren't scaling; you’re just moving your technical debt 10ms closer to the user.



Origin Protection: Designing for the "Thundering Herd
```

## Prompt 4.3 — The Consistency Model Selector

**When to use this:** When choosing a consistency model for a specific data type and you want the trade-off made explicit rather than defaulting to strong consistency everywhere.

```text
Act as a distributed-systems reviewer. For each data type below (product price, inventory count, review text, user profile), recommend strong / read-your-writes / eventual consistency, state the user-visible failure mode of getting it wrong, and note where stale data costs money versus merely delays information.
```

## Prompt 4.4 — The Protocol Readiness Check

**When to use this:** Before enabling HTTP/3 in production, to confirm the upgrade will actually help and won't mask an application-layer bottleneck.

```text
"Act as a performance engineer. Given my latency breakdown (DNS, TLS, TTFB, transfer, backend) and my CDN/edge config, estimate how much HTTP/3 (QUIC) is likely to help, name the delays it will NOT fix (slow queries, N+1 APIs, backend processing), and tell me what to fix first if transport is not the dominant cost."




Non-Negotiable:
You cannot deploy HTTP/3 as your sole protocol. Because corporate firewalls often block UDP port 443, a reliable architecture must include a graceful fallback to TCP-based HTTP/2.
```

## Prompt 4.1 — The Edge Logic Migration

**When to use this:** Use this during your Pre-Migration Performance Audit to identify which high-latency controllers are candidates for Edge offloading."

```text
Act as a Principal Systems Architect. I am looking to reduce the 'Time to First Byte' (TTFB) for my global users.
Analyze this Node.js 'Product Page' controller code.
Identify logic that can be moved to an Edge Function, specifically: geographic redirection, A/B testing cookie logic, and header-based authentication checks.
Provide a 'Stale-While-Revalidate' configuration for the CDN headers that allows the page to stay 'Up' in read-only mode even if the origin database times out."
```
