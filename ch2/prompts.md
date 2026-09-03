# Chapter 2 — Architect's Prompts

**Core Principles of Scalable Architecture**

The Architect's Prompts from Chapter 2, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**3 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [2.1 The Dependency Audit](#prompt-21--the-dependency-audit) | Run this analysis during your Migration Planning phase, before a single line of code is… |
| [2.2 The State Hunter](#prompt-22--the-state-hunter) | When auditing a service you intend to scale horizontally, to find every place it secretly… |
| [2.3 The Telemetry Weaver](#prompt-23--the-telemetry-weaver) | Adopt this pattern immediately. If you wait until teams scale independently, observability… |

---

## Prompt 2.1 — The Dependency Audit

**When to use this:** Run this analysis during your Migration Planning phase, before a single line of code is moved. It prevents the "Distributed Monolith" trap by exposing the "hidden veins", circular dependencies and shared state—that often cause extractions to fail.

```text
Act as a Senior Software Architect. I am planning to extract the 'Cart' module from my Node.js monolith into a separate microservice.
Below is the package.json and a list of require() statements found in the cart/ directory.
Task:
Identify which dependencies are 'shared' with the core monolith (e.g., shared database models, utility libraries) and flag them as High Risk for extraction.
Suggest a 'Seam' strategy: Should I duplicate the shared utility code, or publish it as a private NPM package first?
Highlight any circular dependencies that would break if I moved this folder to a new repository.
```

## Prompt 2.2 — The State Hunter

**When to use this:** When auditing a service you intend to scale horizontally, to find every place it secretly keeps state in local memory before you stand up a second instance.

```text
Act as a Security and Scalability Auditor. Review the following legacy authentication code snippet.
Task:
Identify any lines where state is being stored in local memory (e.g., req.session, global variables, or local file writes) which would fail in a horizontally scaled environment.
Rewrite the specific stateful lines to use a Redis-based pattern (using redisClient.set / redisClient.get).
Add a 'Retry with Exponential Backoff' logic to the Redis connection to prevent the app from crashing if the cache blips.
```

## Prompt 2.3 — The Telemetry Weaver

**When to use this:** Adopt this pattern immediately. If you wait until teams scale independently, observability standards will diverge, and you will be left trying to patch together incompatible logs. Use this prompt to generate a standard middleware library that every new service imports by default.

```text
Act as a Middleware Engineer. I have an existing Express.js service with 50 endpoints. I need to enforce Observability Standards without rewriting every route.
Task:
Write a correlation-id-middleware.js that checks for an incoming X-Correlation-ID header. If missing, generate a UUID.
Crucial: Demonstrate how to wrap the standard console.log or winston logger so that every subsequent log line in the request scope automatically includes this ID.
Show how to inject this ID into the headers of any downstream axios or fetch calls made by this service, ensuring the 'Trace' is unbroken.
```
