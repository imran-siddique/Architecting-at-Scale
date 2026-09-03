# Chapter 5 — Architect's Prompts

**Scaling the Modern Web Application – State, Performance, and Micro-Frontends**

The Architect's Prompts from Chapter 5, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [5.1 The Micro-Frontend Migration Audit](#prompt-51--the-micro-frontend-migration-audit) | Use this prompt during the planning phase of a Micro-Frontend migration to identify hidden… |
| [5.2 State Architecture Audit](#prompt-52--state-architecture-audit) | Use this prompt when migrating from a monolithic global store to a micro-frontend state… |
| [5.3 Rendering Strategy Assignment](#prompt-53--rendering-strategy-assignment) | Use this prompt when auditing an existing application's rendering approach or planning a new… |
| [5.4 Performance Budget Audit](#prompt-54--performance-budget-audit) | Use this prompt during a quarterly performance review or before a major feature launch to… |
| [5.5 Resilience Audit](#prompt-55--resilience-audit) | Use this prompt before a major traffic event (holiday sale, product launch, marketing… |

---

## Prompt 5.1 — The Micro-Frontend Migration Audit

**When to use this:** Use this prompt during the planning phase of a Micro-Frontend migration to identify hidden coupling and generate a prioritized decomposition roadmap.

```text
Act as a Principal Frontend Architect. I have a monolithic React SPA with [X] teams contributing to one repository. The bundle size is [Y] MB gzipped. Deployment frequency has dropped to [Z] per week due to merge conflicts and shared pipeline contention.

Analyze the following top-level directory structure and package.json dependencies:

[Paste directory tree and package.json]

Identify: (1) Implicit cross-module dependencies that would break if modules were deployed independently. (2) Shared code that should be extracted into a versioned internal package. (3) A recommended decomposition order based on minimizing cross-team coupling.

Output a Migration Risk Matrix with columns: Module Name, Shared Dependencies Count, Estimated Extraction Complexity (Low/Medium/High), and Recommended Extraction Order.
```

## Prompt 5.2 — State Architecture Audit

**When to use this:** Use this prompt when migrating from a monolithic global store to a micro-frontend state architecture, to identify which state should be shared vs. owned.

```text
Act as a Senior Frontend Architect specializing in state management. I am decomposing a monolithic React application into [X] micro-frontends. Currently, we have a single Redux store with [Y] top-level slices.

Here is the current Redux state shape:

[Paste your root reducer or state type definition]

For each state slice, classify it as: (1) Domain State - owned exclusively by one micro-app, (2) Session State - owned by a shared auth service, (3) Cross-App Coordination - requires an Event Bus, or (4) UI Orchestration - owned by the Shell.

For each Cross-App Coordination item, define the event contract: event name, payload shape, and recommended fallback behavior if the publishing micro-app is unavailable.

Output a State Migration Matrix with columns: State Slice, Current Owner, Target Owner, Communication Mechanism, Fallback Strategy, Migration Risk (Low/Medium/High).
```

## Prompt 5.3 — Rendering Strategy Assignment

**When to use this:** Use this prompt when auditing an existing application's rendering approach or planning a new application's route-level rendering assignments.

```text
Act as a Senior Frontend Performance Architect. I have an application with the following routes and their characteristics:

[Paste a list of routes with: route path, data change frequency, whether content is user-specific, current rendering strategy, and current LCP metric]

For each route, recommend the optimal rendering strategy (CSR, SSR, SSG, or ISR) based on data freshness requirements and personalization needs. For ISR recommendations, specify the revalidation TTL and justify why the staleness window is acceptable.

Output a Rendering Assignment Table with columns: Route, Current Strategy, Recommended Strategy, Revalidation TTL (if ISR), Expected LCP Improvement, and Migration Complexity (Low/Medium/High).
```

## Prompt 5.4 — Performance Budget Audit

**When to use this:** Use this prompt during a quarterly performance review or before a major feature launch to identify the highest-impact optimization targets.

```text
Act as a Senior Web Performance Engineer. I have a web application with the following current Core Web Vitals:

LCP: [X]s, FID: [Y]ms, CLS: [Z], Total Bundle Size: [A]MB, Main Thread Blocking Time: [B]s

My user base is distributed as follows: [paste device/network segment breakdown]

Analyze the attached Lighthouse report or describe the top 5 largest JavaScript chunks and their purpose.

Identify: (1) The top 3 Long Tasks contributing to main thread blocking. (2) Dependencies that can be lazy-loaded, deferred, or replaced with lighter alternatives. (3) Third-party scripts that should be loaded via requestIdleCallback. (4) Routes where the rendering strategy should change (CSR to SSR or SSG).

Output a Performance Improvement Roadmap with columns: Optimization, Estimated Impact on LCP, Estimated Impact on TTI, Implementation Effort (Low/Medium/High), and Priority Order.
```

## Prompt 5.5 — Resilience Audit

**When to use this:** Use this prompt before a major traffic event (holiday sale, product launch, marketing campaign) to validate that your UI can survive partial backend failures.

```text
Act as a Site Reliability Engineer specializing in frontend resilience. I have a web application with the following page structure:

[Paste the component tree for your highest-traffic page, identifying which components call which backend services]

For each component, classify it as 'Critical Path' (must always render for the user to complete their primary task) or 'Enhancement' (can be removed without blocking the primary task).

For each Enhancement component, recommend a degradation strategy: Silent Removal (render null), Cached Fallback (serve from sessionStorage), or Reduced Functionality (disable interactive features, show static content).

For each Critical Path component, identify the backend dependency and recommend a circuit breaker timeout. What is the maximum time the UI should wait for this service before showing an explicit error message?

Output a Resilience Matrix with columns: Component, Classification, Backend Dependency, Degradation Strategy, Circuit Breaker Timeout, and Fallback UI Description.
```
