# Feature Flags: The Kill Switch and the Experiment

Feature flags serve two fundamentally different purposes, and conflating them is how teams end up with 300 flags in production and no idea which ones are still active.

## Purpose 1: Safety (Kill Switch)

A feature flag that allows you to disable a newly deployed component without a full rollback. This is a **Safe Scale** primitive—it reduces blast radius by making any change reversible in seconds.

## Purpose 2: Experimentation (A/B Testing)

A feature flag that routes a percentage of users to a variant to measure behavioral impact. The new Search auto-complete is shown to 10% of users. If engagement metrics improve, the rollout expands.

Both purposes are valid. Both use the same underlying mechanism. The critical discipline is in **lifecycle management**.

---

## Anti-Pattern: The Flag Graveyard

Feature flags accumulate. A team ships a flag for a new widget. The widget launches successfully. The flag stays in the codebase—"just in case." Six months later, the codebase has 200 flags. Nobody knows which are active, which are stale, and which are accidentally controlling critical behavior.

Worse, the combinatorial explosion of flag states makes testing nearly impossible. With 10 binary flags, you have **1,024 possible application states**. No QA team is testing 1,024 states.

> **The Flag Hygiene Rule:** Every feature flag must have an expiration date set at creation time. Kill-switch flags expire 30 days after full rollout. Experiment flags expire when the experiment concludes and the winning variant is hardcoded. A weekly automated report surfaces all flags past their expiration date. A flag that has been at 100% rollout for more than 30 days is not a feature flag—it is dead code with a runtime cost.

```typescript
// Feature Flag definition with mandatory expiration
// File: shell/src/flags/flag-registry.ts

interface FeatureFlag {
  id: string;
  purpose: 'kill-switch' | 'experiment';
  owner: string;
  createdAt: string;
  expiresAt: string;   // Mandatory
  rolloutPercentage: number;
  description: string;
}

const FLAG_REGISTRY: FeatureFlag[] = [
  {
    id: 'new-checkout-flow',
    purpose: 'kill-switch',
    owner: 'checkout-team',
    createdAt: '2026-01-15',
    expiresAt: '2026-02-15',  // 30 days post-launch
    rolloutPercentage: 100,
    description: 'Redesigned checkout with single-page form.',
  },
  {
    id: 'search-autocomplete-v2',
    purpose: 'experiment',
    owner: 'search-team',
    createdAt: '2026-02-01',
    expiresAt: '2026-03-01',  // Experiment window
    rolloutPercentage: 10,
    description: 'A/B test: new autocomplete with fuzzy matching.',
  },
];

// Weekly audit: surface expired flags
export function getExpiredFlags(): FeatureFlag[] {
  const now = new Date();
  return FLAG_REGISTRY.filter((flag) => new Date(flag.expiresAt) < now);
}
```

---

## Safe Scale Check — Reversibility and Blast Radius

Feature flags are the most granular reversibility mechanism available in a frontend architecture. A deployment rollback reverts *all* changes. A feature flag toggle reverts *one* change.

Combined with the micro-frontend architecture from Section 1, this creates a **layered safety model**: a crash in the Search micro-app is caught by its Error Boundary, and if the crash is caused by a new feature, the feature flag is toggled off without affecting any other micro-app or any other feature.

> The blast radius of a bad feature flag is **one feature**. The blast radius of a bad deployment in a monolith is **the entire application**. This asymmetry is the entire argument for this chapter.
