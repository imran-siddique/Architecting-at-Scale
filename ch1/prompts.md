# Chapter 1 — Architect's Prompts

**The Scalability Mindset - When and Why to Scale**

The Architect's Prompts from Chapter 1, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**2 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [1.1 The Diagnosis](#prompt-1-1-the-diagnosis) | When your telemetry shows rising p99 latency or connection-pool saturation and you need to… |
| [1.2 The Zombie Hunter](#prompt-1-2-the-zombie-hunter) | Before any scaling project, to surface dead code paths and unused dependencies you can… |

---

## Prompt 1.1 — The Diagnosis

**When to use this:** When your telemetry shows rising p99 latency or connection-pool saturation and you need to confirm the bottleneck with evidence before changing any architecture.

```text
Act as a Site Reliability Engineer. I am pasting a sample of my Nginx access logs and my MySQL slow query log below. Analyze the timestamps to find correlations. Specifically, identify if the p99 latency spikes in the web layer correlate with specific LOCK_WAIT_TIMEOUT events in the database layer. Output the top 3 SQL queries responsible for the contention.
```

## Prompt 1.2 — The Zombie Hunter

**When to use this:** Before any scaling project, to surface dead code paths and unused dependencies you can delete outright instead of paying to scale them.

```text
Analyze this project structure. Identify 'Dead Code' paths. Specifically, look for API endpoints defined in routes.js that are never called by the frontend client/src folder. List the top 5 'Zombie Endpoints' that we can delete to reduce our attack surface.
```
