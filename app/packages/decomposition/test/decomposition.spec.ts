import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  assessModule,
  detectVerbBoundaries,
  planDecomposition,
  type ModuleMetrics,
} from '../src/seam-signals.js';
import { StranglerRouter } from '../src/strangler.js';
import { checkCompatibility, type Contract } from '../src/contract-compat.js';

/**
 * ShopFlow's 14-module monolith at the Chapter 6 state: 47-minute builds, 65% deployment success,
 * and 14 concurrent modules contending on the Orders table.
 */

const mod = (over: Partial<ModuleMetrics> & Pick<ModuleMetrics, 'name'>): ModuleMetrics => ({
  buildTimeShare: 0.05,
  testBlastRadiusModules: 0,
  deploySuccessRate: 0.99,
  readWriteRatio: 10,
  mergeConflictsPerSprint: 0,
  contributingTeams: 1,
  ...over,
});

// The four modules the Canon says become bounded contexts, plus quiet ones that should not.
const SHOPFLOW_MODULES: ModuleMetrics[] = [
  mod({ name: 'orders', buildTimeShare: 0.28, testBlastRadiusModules: 9,
        deploySuccessRate: 0.62, readWriteRatio: 3, mergeConflictsPerSprint: 11, contributingTeams: 4 }),
  mod({ name: 'inventory', buildTimeShare: 0.16, testBlastRadiusModules: 5,
        deploySuccessRate: 0.71, readWriteRatio: 4, mergeConflictsPerSprint: 6, contributingTeams: 3 }),
  mod({ name: 'catalog', buildTimeShare: 0.22, testBlastRadiusModules: 4,
        deploySuccessRate: 0.80, readWriteRatio: 400, mergeConflictsPerSprint: 4, contributingTeams: 3 }),
  mod({ name: 'payments', buildTimeShare: 0.09, testBlastRadiusModules: 6,
        deploySuccessRate: 0.68, readWriteRatio: 2, mergeConflictsPerSprint: 5, contributingTeams: 2 }),
  // Quiet modules. Nothing hurts.
  mod({ name: 'reviews', buildTimeShare: 0.03, readWriteRatio: 12 }),
  mod({ name: 'wishlist', buildTimeShare: 0.02, readWriteRatio: 8 }),
  mod({ name: 'tax-tables', buildTimeShare: 0.01, readWriteRatio: 15 }),
];

describe('the Gravity Signal Rule: three signals are a mandate', () => {
  it('CLAIM: a module with two signals is NOT extracted', () => {
    // "A single signal is a data point. Three signals are a mandate." Two is neither.
    const two = mod({ name: 'borderline', buildTimeShare: 0.4, mergeConflictsPerSprint: 9 });
    const a = assessModule(two, [10, 12, 8]);
    expect(a.active).toHaveLength(2);
    expect(a.extract).toBe(false);
  });

  it('CLAIM: crossing the third signal flips it to a mandate', () => {
    const three = mod({
      name: 'borderline', buildTimeShare: 0.4, mergeConflictsPerSprint: 9, deploySuccessRate: 0.6,
    });
    const a = assessModule(three, [10, 12, 8]);
    expect(a.active).toHaveLength(3);
    expect(a.extract).toBe(true);
  });

  it('CLAIM: the No-Signal Rule keeps quiet modules in the monolith', () => {
    // "A module with no active seam signal is not a service waiting to be born. It is a module
    // doing its job." This is the only decision on the chapter's list that is free.
    const plan = planDecomposition(SHOPFLOW_MODULES);
    expect(plan.stay.map((s) => s.name)).toEqual(['reviews', 'tax-tables', 'wishlist']);
    for (const s of plan.stay) expect(s.active).toEqual([]);
  });

  it('detects divergent scaling only by comparison with neighbours', () => {
    // Catalog is read-heavy at 400:1 against neighbours around 3:1. That signal cannot be
    // evaluated for a module in isolation, which is why the comparison is an input.
    const catalog = SHOPFLOW_MODULES.find((m) => m.name === 'catalog')!;
    const withNeighbours = assessModule(catalog, [3, 4, 2, 12]);
    expect(withNeighbours.active).toContain('scalingDivergesFromNeighbours');

    // Among equally read-heavy peers, the same module is unremarkable.
    const amongPeers = assessModule(catalog, [380, 400, 420]);
    expect(amongPeers.active).not.toContain('scalingDivergesFromNeighbours');
  });

  it('a healthy module trips nothing', () => {
    const a = assessModule(mod({ name: 'healthy' }), [10, 11, 9]);
    expect(a.active).toEqual([]);
    expect(a.extract).toBe(false);
  });
});

describe('the Extraction Sequence Doctrine', () => {
  const plan = planDecomposition(SHOPFLOW_MODULES);

  it('CLAIM: extracts in descending order of pain, highest first', () => {
    // "Never leave the highest-pain module for last." Orders has the worst deploy success, the
    // widest blast radius and the most merge conflicts, so it goes first.
    expect(plan.sequence[0]!.name).toBe('orders');
  });

  it('CLAIM: the highest-pain module is never last', () => {
    const worst = [...plan.sequence].sort((a, b) => b.painScore - a.painScore)[0]!;
    expect(plan.sequence.at(-1)!.name).not.toBe(worst.name);
  });

  it('the sequence is exactly the modules that qualify', () => {
    expect(plan.sequence.map((s) => s.name).sort())
      .toEqual(['catalog', 'inventory', 'orders', 'payments']);
    for (const s of plan.sequence) expect(s.active.length).toBeGreaterThanOrEqual(3);
  });

  it('the Service Count Rule gives the minimum, not an aspiration', () => {
    // Four extractions plus the monolith, which is still a service while anything remains in it.
    // This is the Canon's "14 modules become 6 services" arrived at from the signals rather than
    // chosen: four bounded contexts, the monolith, and Reviews staying inside Catalog.
    expect(plan.minimumServiceCount).toBe(5);
  });
});

describe('Anti-Pattern: the Verb Boundary', () => {
  it('CLAIM: flags a decomposition by HTTP method', () => {
    // Architecturally coherent, domain-incoherent. It trades one deployment dependency for four.
    expect(detectVerbBoundaries(['Order Create Service', 'Order Read Service', 'order-update-svc']))
      .toHaveLength(3);
  });

  it('passes a decomposition by domain', () => {
    expect(detectVerbBoundaries(['orders', 'inventory', 'catalog', 'payments'])).toEqual([]);
  });

  it('does not false-positive on a domain word that contains a verb', () => {
    // "credentials" contains no standalone verb; matching on substrings rather than words would
    // flag it and teach the team to ignore the check.
    expect(detectVerbBoundaries(['credentials', 'readiness-probe-config'])).toEqual([]);
  });
});

describe('the Strangler Fig and the Time-Box Mandate', () => {
  const DAY = 86_400_000;
  const T0 = 1_700_000_000_000;

  const router = (weight: number, completeIn: number, wave: 1 | 2 | 3 = 2) =>
    new StranglerRouter({
      completeBy: T0 + completeIn,
      now: () => T0,
      rules: [{ prefix: '/api/orders', service: 'orders-svc', weight, wave }],
    });

  it('CLAIM: a router cannot be constructed without a completion date', () => {
    // "A migration without a completion constraint does not complete; it becomes a permanent
    // operational state." So the constraint is a constructor argument, not a convention.
    expect(() => new StranglerRouter({ completeBy: NaN, rules: [] }))
      .toThrow(/requires a Wave 3 completion date/);
  });

  it('splits traffic by weight and falls through to the monolith', () => {
    const r = router(0.1, 30 * DAY);
    expect(r.route('/api/orders/123', 0.05)).toMatchObject({ target: 'service', service: 'orders-svc' });
    expect(r.route('/api/orders/123', 0.5)).toMatchObject({ target: 'monolith' });
    expect(r.route('/api/reviews/9', 0.01)).toEqual({ target: 'monolith' });
  });

  it('matches the longest prefix, so a nested route is not swallowed', () => {
    const r = new StranglerRouter({
      completeBy: T0 + 30 * DAY, now: () => T0,
      rules: [
        { prefix: '/api/orders', service: 'orders-svc', weight: 1, wave: 2 },
        { prefix: '/api/orders/returns', service: 'returns-svc', weight: 1, wave: 2 },
      ],
    });
    expect(r.route('/api/orders/returns/7', 0).service).toBe('returns-svc');
    expect(r.route('/api/orders/7', 0).service).toBe('orders-svc');
  });

  it('CLAIM: reports the migration complete only at 100% and Wave 3', () => {
    expect(router(1, 30 * DAY, 2).status().migrationComplete).toBe(false); // full traffic, wrong wave
    expect(router(0.9, 30 * DAY, 3).status().migrationComplete).toBe(false); // right wave, not full
    expect(router(1, 30 * DAY, 3).status().migrationComplete).toBe(true);
  });

  it('CLAIM: the Permanent Proxy check fails on a DATE, not on someone noticing', () => {
    // The proxy works, so there is never a day when leaving it becomes visibly wrong. That is
    // exactly why the deadline has to fail the build by itself.
    const overdue = router(0.5, -10 * DAY);
    expect(overdue.status().overdue).toBe(true);
    expect(() => overdue.assertNotPermanent()).toThrow(/past its published completion date/);
  });

  it('does not fire once the migration is genuinely finished, even long past the date', () => {
    const done = router(1, -400 * DAY, 3);
    expect(done.status().overdue).toBe(false);
    expect(() => done.assertNotPermanent()).not.toThrow();
  });

  it('rejects a nonsensical weight or a relative prefix', () => {
    expect(() => new StranglerRouter({ completeBy: T0, rules: [{ prefix: '/a', service: 's', weight: 1.5, wave: 1 }] }))
      .toThrow(RangeError);
    expect(() => new StranglerRouter({ completeBy: T0, rules: [{ prefix: 'api/a', service: 's', weight: 1, wave: 1 }] }))
      .toThrow(/must be absolute/);
  });
});

describe('the Silent Breaking Change Rule', () => {
  const v1: Contract = {
    version: 'v1',
    fields: [
      { name: 'orderId', type: 'string', required: true },
      { name: 'totalCents', type: 'number', required: true, invariant: 'always non-negative' },
      { name: 'note', type: 'string', required: false },
    ],
  };

  it('CLAIM: an invariant change is breaking even when the schema is IDENTICAL', () => {
    // This is the rule's whole point. Nothing in the shape changed. Consumers that relied on the
    // old guarantee break, and no schema diff tool will tell you.
    const after: Contract = {
      version: 'v1',
      fields: v1.fields.map((f) =>
        f.name === 'totalCents' ? { ...f, invariant: 'may be negative for refunds' } : f,
      ),
    };
    const r = checkCompatibility(v1, after, 'tolerant');

    expect(r.breaking).toBe(true);
    expect(r.breaks[0]).toMatchObject({ kind: 'invariant-changed', field: 'totalCents' });
    expect(r.requiresVersionBump).toBe(true);
  });

  it('CLAIM: an additive change breaks a STRICT deserializer', () => {
    // "Additive changes are safe" is true only against tolerant readers, and strict is the
    // default in several languages. So strict is the default here too.
    const after: Contract = {
      version: 'v1',
      fields: [...v1.fields, { name: 'currency', type: 'string', required: false }],
    };
    expect(checkCompatibility(v1, after).breaking).toBe(true);
    expect(checkCompatibility(v1, after, 'tolerant').breaking).toBe(false);
  });

  it('flags removals, type changes and newly required fields', () => {
    const removed = { ...v1, fields: v1.fields.filter((f) => f.name !== 'note') };
    expect(checkCompatibility(v1, removed, 'tolerant').breaks[0]).toMatchObject({ kind: 'field-removed' });

    const retyped = {
      ...v1,
      fields: v1.fields.map((f) => (f.name === 'totalCents' ? { ...f, type: 'string' as const } : f)),
    };
    expect(checkCompatibility(v1, retyped, 'tolerant').breaks.map((b) => b.kind))
      .toContain('field-type-changed');

    const nowRequired = {
      ...v1,
      fields: v1.fields.map((f) => (f.name === 'note' ? { ...f, required: true } : f)),
    };
    expect(checkCompatibility(v1, nowRequired, 'tolerant').breaks.map((b) => b.kind))
      .toContain('optional-became-required');
  });

  it('CLAIM: a breaking change WITH a version bump is compliant', () => {
    // The rule does not forbid breaking changes. It requires a version increment for them.
    const after: Contract = {
      version: 'v2',
      fields: v1.fields.filter((f) => f.name !== 'note'),
    };
    const r = checkCompatibility(v1, after, 'tolerant');
    expect(r.breaking).toBe(true);
    expect(r.versionIncremented).toBe(true);
    expect(r.requiresVersionBump).toBe(false);
  });

  it('an identical contract is not a change at all', () => {
    const r = checkCompatibility(v1, structuredClone(v1));
    expect(r.breaking).toBe(false);
    expect(r.breaks).toEqual([]);
  });

  it('sanity: the default thresholds are the ones the chapter states', () => {
    expect(DEFAULT_THRESHOLDS.deploySuccessSlo).toBe(0.95);
  });
});
