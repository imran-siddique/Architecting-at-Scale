# Chapter 16 — Architect's Prompts

**Continuous Experimentation and the Future-Proof System**

The Architect's Prompts from Chapter 16, reproduced verbatim from the book so you can paste them
straight into whichever assistant you use. Each one carries the *When to use this* line from the
chapter, because a prompt is only as good as the moment you reach for it.

Before running any of these, replace every `[bracketed placeholder]` with your own data. These
prompts are deliberately demanding — they ask for a decision with its reasoning, not a summary.

**5 prompts in this chapter.**


| Prompt | Use it when |
|--------|-------------|
| [16.1 The Stagnation Audit](#prompt-16-1-the-stagnation-audit) | Use this prompt when health metrics are green but the team has slowed or stopped shipping,… |
| [16.2 The Flag Lifecycle Audit](#prompt-16-2-the-flag-lifecycle-audit) | Use this prompt to audit an accumulated population of feature flags, separate genuine… |
| [16.3 The Architectural Experiment Design](#prompt-16-3-the-architectural-experiment-design) | Use this prompt when facing a large architectural decision you are tempted to make on… |
| [16.4 The Feedback Loop Design](#prompt-16-4-the-feedback-loop-design) | Use this prompt to turn a planned feature or change into a ship-and-learn loop, so… |
| [16.5 The Future-Proofing Audit](#prompt-16-5-the-future-proofing-audit) | Use this prompt to evaluate whether a system is future-proof in the way that matters: safe… |

---

## Prompt 16.1 — The Stagnation Audit

**When to use this:** Use this prompt when health metrics are green but the team has slowed or stopped shipping, to diagnose stagnation and prescribe the experimentation capability that cures it.

```text
Act as a Principal Engineer diagnosing delivery stagnation. Our system is
healthy at rest but the team has stopped shipping confidently.

Delivery metrics: deployment frequency [x], lead time [x], change failure
rate [x], time to restore [x]. Health metrics: [all green / details].
Current safe-change capability: [flags, canary, rollback, or none].

Do the following:
(1) Confirm the diagnosis: stagnation hidden behind healthy at-rest metrics.
(2) Identify which safe-change primitive is missing: small independent
    changes, staged rollout, signal-based measurement, automated rollback.
(3) Prescribe the smallest capability that would let the team ship to 1% and
    reverse automatically, and the order to build it in.
(4) State the market cost of the current lead time versus a faster cadence.
(5) Define the delivery metrics to track as the system's evolutionary fitness.
```

## Prompt 16.2 — The Flag Lifecycle Audit

**When to use this:** Use this prompt to audit an accumulated population of feature flags, separate genuine experiments from forgotten branches, and produce a retirement plan.

```text
Act as a Principal Engineer enforcing feature-flag hygiene. We have
accumulated many flags and lost track of which are still meaningful.

Flag inventory: [list with creation date, owner, current rollout %, purpose].

Do the following:
(1) Classify each flag: active experiment, should-be-config (make permanent),
    or graveyard (expired, remove).
(2) For each graveyard flag, give the safe retirement step: confirm the path
    is dead or fully rolled out, then delete, one at a time.
(3) Flag any item that is really a configuration and recommend converting it
    out of the flag system entirely.
(4) Assign a mandatory expiry date to every flag that survives as an
    experiment.
(5) Recommend a maximum live-flag count and the policy that enforces it.
```

## Prompt 16.3 — The Architectural Experiment Design

**When to use this:** Use this prompt when facing a large architectural decision you are tempted to make on conviction, to design it as a reversible production experiment instead.

```text
Act as a Principal Architect. I am about to make a major architectural
decision and I want to test it in production rather than decide on intuition.

Decision: [scale-up vs scale-out / new store / new model / new protocol].
Current architecture: [describe]. Proposed change: [describe].
My current conviction and why: [state it].

Do the following:
(1) State the hypothesis the experiment will test, and the result that would
    overturn my conviction.
(2) Design the safe experiment: shadow or canary, traffic slice, the signals
    measured, and the automatic rollback condition.
(3) For a scaling decision, compare predictability per unit, not just peak
    performance.
(4) Define the blast radius: which paths, what percentage, how the old
    architecture stays the default.
(5) State the decision rule: what the data must show to widen, and what
    reverts the experiment.
```

## Prompt 16.4 — The Feedback Loop Design

**When to use this:** Use this prompt to turn a planned feature or change into a ship-and-learn loop, so production data drives the next version instead of a fixed upfront plan.

```text
Act as a Principal Engineer who ships to learn. I have a planned change and
I want to run it as a feedback loop instead of building it all up front.

Planned change: [description]. The assumption it rests on: [state it].
How I would know the assumption is wrong: [signal].

Do the following:
(1) Define the smallest real version that would test the core assumption.
(2) Design the ship-to-a-slice rollout and the signals that measure the
    result against the assumption.
(3) Specify what production behavior would confirm, revise, or abandon the plan.
(4) Classify the decision as reversible (move fast) or irreversible (slow
    down) and justify it.
(5) Define how the result feeds the next hypothesis, so production informs
    the roadmap continuously.
```

## Prompt 16.5 — The Future-Proofing Audit

**When to use this:** Use this prompt to evaluate whether a system is future-proof in the way that matters: safe and changeable regardless of which components it uses or who operates it.

```text
Act as a Principal Architect evaluating whether a system is future-proof.
Future-proof here means safe and changeable regardless of components or
operator, not betting on a specific technology.

System: [description]. Key components: [list]. Who and what can change it:
[engineers of varying skill, autonomous AI, etc.].

Do the following:
(1) Separate the system into what will be replaced (concrete components) and
    what must endure (boundaries, gates, feedback loops).
(2) Verify the enduring properties: loose coupling, observability,
    reversibility, blast-radius control, runtime governance, kill switch.
(3) Test the operator-agnostic property: would the system stay safe if a
    change were made by a junior engineer or an autonomous AI?
(4) Flag any safety that depends on a careful human operator rather than on
    a structural boundary, and move it into the structure.
(5) Give a future-proofing score and the gaps to close.
```
