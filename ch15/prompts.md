# Chapter 15 — Architect's Prompts

**AI-First Architecture: Pragmatism Over Hype**

The Architect's Prompts from Chapter 15, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [15.1 The Intelligence Choice Audit](#prompt-15-1-the-intelligence-choice-audit) | Use this prompt in an architecture review when a proposed feature includes a model or an… |
| [15.2 The Agent Production-Readiness Review](#prompt-15-2-the-agent-production-readiness-review) | Use this prompt before promoting an agent from a pilot or demo into production, to find the… |
| [15.3 The AI Endpoint Readiness Audit](#prompt-15-3-the-ai-endpoint-readiness-audit) | Use this prompt before publishing a model or MCP endpoint that agents can discover and call,… |
| [15.4 The Agent Governance Design](#prompt-15-4-the-agent-governance-design) | Use this prompt to design the runtime governance for an agent that will take consequential… |
| [15.5 The Kill Switch and Approval Design](#prompt-15-5-the-kill-switch-and-approval-design) | Use this prompt to design the kill switch and human-in-the-loop gates for an agent before it… |

---

## Prompt 15.1 — The Intelligence Choice Audit

**When to use this:** Use this prompt in an architecture review when a proposed feature includes a model or an agent, to test whether the intelligence is genuinely required before any of it is built.

```text
Act as a Principal Architect applying a determinism-first review. I am
evaluating a proposed feature that includes a model or an agent.

Feature: [description]. Proposed AI component: [model / agent].
Inputs: [describe the input space]. Outputs: [describe the output set].
Does a deterministic solution already exist or is it feasible? [yes/no].
Is this on a user-facing path? [yes/no].

Do the following:
(1) Classify the problem: bounded inputs with enumerable outputs (use code),
    structured prediction (use a traditional ML model), or unbounded language
    with unspecifiable output (use an LLM).
(2) If a deterministic path exists, recommend it and state what the model
    would only add (latency, cost, chance of an excluded answer).
(3) Name the specific capability the model provides that code cannot. If you
    cannot name one, fail the proposal.
(4) If the feature is user-facing, raise the bar and require that the model
    cannot degrade the wider experience.
(5) Give the final recommendation: rules, traditional ML, or LLM, with the
    reasoning a reviewer can defend in the room.
```

## Prompt 15.2 — The Agent Production-Readiness Review

**When to use this:** Use this prompt before promoting an agent from a pilot or demo into production, to find the governance gap the demo did not expose.

```text
Act as a Principal Engineer who has built runtime governance for agents.
I am promoting an agent from a successful pilot into production.

Agent purpose: [description]. Tools it can call: [list].
Actions it can take: [list, with which are consequential].
Data it can access: [list]. Current governance: [describe, or none].

Do the following:
(1) List the production conditions the pilot did not test: hostile inputs,
    tool failures, ambiguous instructions, and behavioral drift.
(2) For each consequential action, define the deterministic policy boundary
    that must gate it: which actions, tools, and data are permitted.
(3) Map the agent's exposure to the OWASP Agentic Top 10 and flag the
    uncovered risks.
(4) Specify the audit trail: what must be recorded for every action to make
    it attributable and explainable after the fact.
(5) State a go or no-go recommendation with the governance that must exist
    before go.
```

## Prompt 15.3 — The AI Endpoint Readiness Audit

**When to use this:** Use this prompt before publishing a model or MCP endpoint that agents can discover and call, to size and govern it for an overnight step change rather than a forecastable ramp.

```text
Act as a Principal Engineer operating AI-facing endpoints at scale. I am
about to publish a model or MCP endpoint that agents can discover.

Endpoint: [description]. Tools exposed: [list]. Current traffic: [calls/day].
Current governance: [scoping, rate limits, identity, logging, or none].
Autoscaling ceiling: [set / not set].

Do the following:
(1) Model an overnight 10x step change in traffic, not a gradual ramp.
(2) Identify what breaks first: tool exposure, attribution, rate fairness,
    capacity, or cost. Rank them.
(3) Specify the gateway governance to publish WITH the endpoint: per-agent
    tool scoping, per-consumer rate limits, verified identity, full logging.
(4) Confirm the autoscaling ceiling and per-consumer budget from the cost
    governance are in place.
(5) Give the publish or hold recommendation and the controls required first.
```

## Prompt 15.4 — The Agent Governance Design

**When to use this:** Use this prompt to design the runtime governance for an agent that will take consequential actions, mapping its risks to deterministic controls before it ships.

```text
Act as a Principal Engineer specializing in runtime agent governance.
Help me govern an agent that takes consequential actions in production.

Agent task: [description]. Tools and actions available: [list].
Consequential actions (refunds, reroutes, deletes, etc.): [list].
Current permission model: [describe, or none].

Do the following:
(1) Apply least agency: define the minimum tools, actions, and data the task
    requires, and mark everything else as gated.
(2) Express the permission boundary as policy-as-code, versioned and testable.
(3) Map the agent to the OWASP Agentic Top 10 and give a runtime control for
    each relevant risk, enforced between decision and action.
(4) Define the audit trail that makes every action attributable and
    explainable after the fact.
(5) Confirm no consequential constraint relies on the prompt. Move any that
    does into runtime enforcement.
```

## Prompt 15.5 — The Kill Switch and Approval Design

**When to use this:** Use this prompt to design the kill switch and human-in-the-loop gates for an agent before it is allowed to take any consequential action in production.

```text
Act as a Principal Engineer designing the safety controls for a production
agent. I need a kill switch and the right human-in-the-loop gates.

Agent: [description]. Actions it can take: [list, with reversibility and
impact for each]. Service it runs inside: [name].

Do the following:
(1) Design a kill switch scoped to THIS agent that halts it in seconds,
    without taking down the surrounding service, reachable without a deploy.
(2) Define how the surrounding system degrades gracefully when the agent is
    halted, and a schedule to test the kill switch like a fire drill.
(3) Classify each action as full autonomy, autonomous with kill switch, or
    human-in-the-loop, using reversibility and blast radius as the line.
(4) Specify the approval gate for high-impact actions: what the human sees,
    what the governance layer has already validated, and the audit record.
(5) State the throughput and latency cost of these controls and confirm it is
    acceptable against the cost of an unstoppable action.
```
