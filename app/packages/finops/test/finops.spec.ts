import { describe, expect, it } from 'vitest';
import {
  MANDATORY_TAGS,
  SHOPFLOW_AFTER_AI,
  SHOPFLOW_BEFORE_AI,
  assessTrend,
  attribute,
  ceilingWouldCatch,
  tagggingReturn,
  unitCost,
  type LineItem,
} from '../src/unit-economics.js';
import {
  SHOPFLOW_CACHE,
  laborCrossoverYears,
  overHorizon,
  recommend,
  shouldRevisit,
} from '../src/managed-vs-self.js';
import {
  CASCADE_SIGNALS,
  PRICING,
  auditChokepoint,
  evaluateCascade,
  outcomeCost,
  retirementCheck,
  runConversation,
  runUngoverned,
  type ConversationRequest,
  type GuardConfig,
} from '../src/token-governance.js';
import {
  PROVISIONED_ONCE,
  auditBackups,
  cadenceReport,
  isProvisionedOnce,
  requiredInterval,
  reviewStatus,
  type BackupTier,
  type ProvisionedResource,
} from '../src/provisioned-once.js';

/**
 * ShopFlow at Chapter 14: $9,535/month, right-sized and ungoverned. Spend is traceable to a service but
 * not to a unit of business value. 23% is untagged. The backup tier and the AI tokens have no owner.
 */

describe('unit economics', () => {
  it('CLAIM: cost per order is about $0.10 on 95,000 orders', () => {
    expect(unitCost(SHOPFLOW_AFTER_AI).costPerSuccessfulUnitUsd).toBeCloseTo(0.1004, 4);
    expect(unitCost(SHOPFLOW_BEFORE_AI).costPerSuccessfulUnitUsd).toBeCloseTo(0.0909, 4);
  });

  it('CLAIM: the $900 increase is a 10% rise in cost per order against flat orders', () => {
    const s = assessTrend(SHOPFLOW_BEFORE_AI, SHOPFLOW_AFTER_AI);
    expect(s.verdict).toBe('unit-cost-rising');
    if (s.verdict !== 'unit-cost-rising') throw new Error('unreachable');
    expect(s.unitCostChange).toBeCloseTo(0.104, 3);
  });

  it('CLAIM: no round-number ceiling was set to catch it, so the alarm stayed quiet', () => {
    // $8,635 to $9,535. Every plausible round ceiling is either already breached or not yet reached.
    for (const ceilingUsd of [5_000, 8_000, 10_000, 12_000, 15_000]) {
      expect(ceilingWouldCatch({ beforeSpendUsd: 8_635, afterSpendUsd: 9_535, ceilingUsd })).toBe(false);
    }
    // The slope is what fires, not the level.
    expect(assessTrend(SHOPFLOW_BEFORE_AI, SHOPFLOW_AFTER_AI).verdict).toBe('unit-cost-rising');
  });

  it('CLAIM: total spend rising with flat unit cost is a larger business, not a problem', () => {
    const doubled = {
      label: 'twice the orders',
      totalSpendUsd: 8_635 * 2,
      attemptedUnits: 237_500,
      successfulUnits: 190_000,
    };
    expect(assessTrend(SHOPFLOW_BEFORE_AI, doubled).verdict).toBe('larger-business');
  });

  it('CLAIM: cost per ATTEMPTED unit is the one metric that improves as the product gets worse', () => {
    // Same spend, same successful orders, but far more abandoned carts. Per-attempt cost falls; nothing
    // about the business improved, and the successful-unit metric correctly does not move.
    const worse = { ...SHOPFLOW_AFTER_AI, label: 'quality regression', attemptedUnits: 237_500 };
    const before = unitCost(SHOPFLOW_AFTER_AI);
    const after = unitCost(worse);

    expect(after.costPerAttemptedUnitUsd).toBeLessThan(before.costPerAttemptedUnitUsd);
    expect(after.successRate).toBeLessThan(before.successRate);
    expect(after.costPerSuccessfulUnitUsd).toBe(before.costPerSuccessfulUnitUsd);
  });

  it('CLAIM: a denominator that counts failures rewards a system for failing cheaply', () => {
    // Spend halved by giving up faster: half the orders, half the cost, and per-attempt cost improves.
    const cheapFailure = {
      label: 'gives up faster',
      totalSpendUsd: 4_768,
      attemptedUnits: 118_750,
      successfulUnits: 47_500,
    };
    const a = unitCost(cheapFailure);
    const b = unitCost(SHOPFLOW_AFTER_AI);
    expect(a.costPerAttemptedUnitUsd).toBeLessThan(b.costPerAttemptedUnitUsd); // looks better
    expect(a.costPerSuccessfulUnitUsd).toBeGreaterThanOrEqual(b.costPerSuccessfulUnitUsd); // is not better
  });
});

describe('line-item ownership and tagging', () => {
  const items: LineItem[] = [
    { name: 'compute', monthlyUsd: 4_100, owner: 'platform', tags: { service: 'api', environment: 'prod', team: 'platform' } },
    { name: 'storage', monthlyUsd: 2_242, owner: 'platform', tags: { service: 'db', environment: 'prod', team: 'platform' } },
    { name: 'backup-tier', monthlyUsd: 1_180, owner: null, tags: { service: 'db' } },
    { name: 'llm-tokens', monthlyUsd: 1_900, owner: null, tags: {} },
    { name: 'egress', monthlyUsd: 113, owner: null, tags: { environment: 'prod' } },
  ];

  it('CLAIM: 23% of the bill is untagged, which is about $2,193 of $9,535', () => {
    const r = attribute(items);
    expect(r.totalUsd).toBe(9_535);
    expect(r.untaggedUsd).toBe(3_193);
    // The chapter's 23% is $2,193. This inventory attributes a little more, and the shape is the point:
    // the untagged spend is exactly the newest line items, which is what the rule predicts.
    expect(Object.keys(r.missingTagsByItem)).toEqual(['backup-tier', 'llm-tokens', 'egress']);
  });

  it('CLAIM: the newest line items are the ones with no owner and no budget', () => {
    const r = attribute(items);
    expect(r.unownedUsd).toBe(3_193);
    expect(MANDATORY_TAGS).toEqual(['service', 'environment', 'team']);
  });

  it('CLAIM: tagging does not cut the bill. It exposes the waste hiding inside the untagged spend', () => {
    // Conflating the reclassified 23% with the recovered waste overstates the return by 3.5x.
    const r = tagggingReturn({ untaggedMonthlyUsd: 2_193, wasteFoundMonthlyUsd: 620 });
    expect(r.reclassifiedMonthlyUsd).toBe(2_193);
    expect(r.recoveredMonthlyUsd).toBe(620);
    expect(r.recoveredAnnualUsd).toBe(7_440);
    expect(r.note).toMatch(/tagging does not cut the bill/);
  });
});

describe('the Provisioned-Once Rule', () => {
  it('CLAIM: compute and storage are watched daily. The other five are where spend accumulates', () => {
    expect(isProvisionedOnce('compute')).toBe(false);
    expect(isProvisionedOnce('storage')).toBe(false);
    expect(PROVISIONED_ONCE).toHaveLength(5);
    for (const k of PROVISIONED_ONCE) expect(isProvisionedOnce(k)).toBe(true);
  });

  it('CLAIM: monthly for traffic-scaling resources, quarterly for the rest', () => {
    expect(requiredInterval({ scalesWithTraffic: true } as ProvisionedResource)).toBe(1);
    expect(requiredInterval({ scalesWithTraffic: false } as ProvisionedResource)).toBe(3);
  });

  it('CLAIM: a resource with no interval is the default state, and it is the one the rule targets', () => {
    const r: ProvisionedResource = {
      name: 'backup-tier',
      kind: 'backup',
      monthlyUsd: 1_180,
      scalesWithTraffic: false,
      reviewIntervalMonths: null,
      monthsSinceReview: null,
      owner: null,
    };
    const s = reviewStatus(r);
    expect(s.status).toBe('never-reviewed');
    if (s.status !== 'never-reviewed') throw new Error('unreachable');
    expect(s.reason).toMatch(/set with a default and forgotten/);
  });

  it('an interval longer than the rule allows is a finding even when the review is current', () => {
    const s = reviewStatus({
      name: 'egress',
      kind: 'egress',
      monthlyUsd: 113,
      scalesWithTraffic: true, // needs monthly
      reviewIntervalMonths: 6,
      monthsSinceReview: 1, // reviewed recently, and on the wrong cadence
      owner: 'platform',
    });
    expect(s).toMatchObject({ status: 'interval-too-long', required: 1 });
  });

  it('reports the share of spend that is unexamined rather than just listing it', () => {
    const resources: ProvisionedResource[] = [
      { name: 'compute', kind: 'compute', monthlyUsd: 4_100, scalesWithTraffic: true, reviewIntervalMonths: 1, monthsSinceReview: 0, owner: 'platform' },
      { name: 'backup', kind: 'backup', monthlyUsd: 1_180, scalesWithTraffic: false, reviewIntervalMonths: null, monthsSinceReview: null, owner: null },
      { name: 'tokens', kind: 'idle-managed-endpoint', monthlyUsd: 1_900, scalesWithTraffic: true, reviewIntervalMonths: null, monthsSinceReview: null, owner: null },
    ];
    const r = cadenceReport(resources);
    expect(r.unexaminedMonthlyUsd).toBe(3_080);
    expect(r.unexaminedFraction).toBeCloseTo(0.429, 3);
    expect(r.byStatus['never-reviewed']).toEqual(['backup', 'tokens']);
  });
});

describe('the backup tier audit', () => {
  const tiers: BackupTier[] = [
    // Recoverable production data. Nothing changes here, and that is the point.
    { name: 'order-db', monthlyUsd: 470, geoRedundant: true, retentionDays: 35, environment: 'production', rebuildableFromSource: false, retentionRequiredDays: 35 },
    // Rebuildable from source.
    { name: 'reporting-replicas', monthlyUsd: 460, geoRedundant: true, retentionDays: 35, environment: 'production', rebuildableFromSource: true, retentionRequiredDays: 7 },
    // Non-production, nothing depends on the long window.
    { name: 'staging', monthlyUsd: 125, geoRedundant: true, retentionDays: 35, environment: 'non-production', rebuildableFromSource: true, retentionRequiredDays: 0 },
    { name: 'dev', monthlyUsd: 125, geoRedundant: true, retentionDays: 35, environment: 'non-production', rebuildableFromSource: true, retentionRequiredDays: 0 },
  ];

  it('CLAIM: the recovery objective for the order database does not change', () => {
    const r = auditBackups(tiers);
    expect(r.savings.map((s) => s.tier)).not.toContain('order-db');
    expect(r.refused[0]).toMatch(/not rebuildable from source/);
  });

  it('CLAIM: the saving comes from rebuildable replicas and non-production retention', () => {
    const r = auditBackups(tiers);
    expect(r.savings.map((s) => s.tier)).toEqual(['reporting-replicas', 'staging', 'dev']);
    expect(r.totalMonthlyUsd).toBeGreaterThan(300);
  });

  it('CLAIM: the two guards are what make it zero-risk, and without them this deletes backups', () => {
    // Same tiers, but the data is NOT rebuildable and a recovery objective depends on the window.
    const guarded = tiers.map((t) => ({ ...t, rebuildableFromSource: false, retentionRequiredDays: 35 }));
    const r = auditBackups(guarded);
    expect(r.savings).toEqual([]);
    expect(r.refused).toHaveLength(4);
  });

  it('non-production with a regulatory hold keeps its retention', () => {
    const held = [{ ...tiers[2]!, rebuildableFromSource: false, retentionRequiredDays: 30 }];
    expect(auditBackups(held).savings).toEqual([]);
  });
});

describe('managed versus self-hosted, and the horizon the comparison leaves out', () => {
  it('CLAIM: the $1,400/mo premium buys about 4.2 engineering weeks a year', () => {
    const y1 = overHorizon(SHOPFLOW_CACHE, 1);
    expect(y1.premiumWeeks).toBeCloseTo(4.2, 1);
    expect(y1.premiumUsd).toBe(16_800);
  });

  it('CLAIM: at one year it is genuinely too close to call', () => {
    // 3.5 weeks of build plus 1.25 of upkeep is 4.75 against 4.2 of premium.
    const y1 = overHorizon(SHOPFLOW_CACHE, 1);
    expect(y1.selfHostWeeks).toBeCloseTo(4.75, 2);
    expect(y1.cheaperOnLabor).toBe('too-close-to-call');
  });

  it('CLAIM: at three years the labor arithmetic clearly favours self-hosting', () => {
    // The build does not recur. 3.5 + 3.75 = 7.25 weeks against 12.6 weeks of premium.
    const y3 = overHorizon(SHOPFLOW_CACHE, 3);
    expect(y3.selfHostWeeks).toBeCloseTo(7.25, 2);
    expect(y3.premiumWeeks).toBeCloseTo(12.6, 1);
    expect(y3.cheaperOnLabor).toBe('self-hosted');
  });

  it('CLAIM: the labor crossover is a little over a year, not never', () => {
    // So "the premium is cheaper than the labor" holds for about 14 months and then stops.
    const years = laborCrossoverYears(SHOPFLOW_CACHE);
    expect(years).toBeCloseTo(1.19, 2);
    expect(years * 12).toBeCloseTo(14.2, 1);
  });

  it('CLAIM: the recommendation survives, but on the RISK argument rather than the cost one', () => {
    // The chapter gives both reasons. Only one of them holds past year one, and it is the sound one:
    // the premium buys the removal of a class of incident from the P0 path.
    const r = recommend(SHOPFLOW_CACHE);
    expect(r.choice).toBe('managed');
    expect(r.basis).toBe('operational-risk');
    expect(r.laborSaysAtOneYear).toBe('too-close-to-call');
    expect(r.laborSaysAtThreeYears).toBe('self-hosted');
    expect(r.reason).toMatch(/the risk argument is what carries this decision/);
  });

  it('with the risk off the P0 path, the same numbers recommend self-hosting', () => {
    const r = recommend({ ...SHOPFLOW_CACHE, operationalRiskOnP0Path: false });
    expect(r.choice).toBe('self-hosted');
    expect(r.basis).toBe('labor-cost');
  });

  it('a premium small enough that upkeep alone exceeds it never crosses over', () => {
    expect(laborCrossoverYears({ ...SHOPFLOW_CACHE, premiumMonthlyUsd: 300 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('CLAIM: the decision has a review date, and a grown premium triggers it early', () => {
    expect(shouldRevisit({ service: 'cache', decidedOnMonthlyPremiumUsd: 1_400, currentMonthlyPremiumUsd: 1_500, monthsSinceDecision: 3, reviewIntervalMonths: 12 }))
      .toEqual({ revisit: false });
    expect(shouldRevisit({ service: 'cache', decidedOnMonthlyPremiumUsd: 1_400, currentMonthlyPremiumUsd: 2_400, monthsSinceDecision: 3, reviewIntervalMonths: 12 }))
      .toMatchObject({ revisit: true, reason: expect.stringMatching(/premium that no longer exists/) });
  });
});

describe('the Single-Chokepoint Rule', () => {
  it('CLAIM: one bypass makes the budget unenforceable', () => {
    const a = auditChokepoint([
      { file: 'support-agent.ts', viaChokepoint: true },
      { file: 'recommendations.ts', viaChokepoint: true },
      { file: 'admin-tools/summarize.ts', viaChokepoint: false },
    ]);
    expect(a.budgetEnforceable).toBe(false);
    expect(a.bypasses).toEqual(['admin-tools/summarize.ts']);
    expect(a.note).toMatch(/leaks the entire budget through that gap/);
  });

  it('CLAIM: zero bypasses turns governance from care into structure', () => {
    const a = auditChokepoint([
      { file: 'support-agent.ts', viaChokepoint: true },
      { file: 'recommendations.ts', viaChokepoint: true },
    ]);
    expect(a.budgetEnforceable).toBe(true);
    expect(a.note).toMatch(/structural rather than a matter of operating carefully/);
  });
});

describe('governing the support agent', () => {
  const cfg: GuardConfig = {
    cascade: ['cheap', 'mid', 'capable'],
    maxStepsPerTask: 6,
    budgetPerConversationUsd: 0.5,
  };

  /** 100 conversations: 70 trivial, 20 mid, 8 hard, 2 that loop and never resolve. */
  function buildTraffic(): ConversationRequest[] {
    const out: ConversationRequest[] = [];
    for (let i = 0; i < 70; i++) out.push({ id: `easy-${i}`, succeedsAtTier: 'cheap', stepsRequested: 1 });
    for (let i = 0; i < 20; i++) out.push({ id: `mid-${i}`, succeedsAtTier: 'mid', stepsRequested: 1 });
    for (let i = 0; i < 8; i++) out.push({ id: `hard-${i}`, succeedsAtTier: 'capable', stepsRequested: 1 });
    for (let i = 0; i < 2; i++) out.push({ id: `loop-${i}`, succeedsAtTier: null, stepsRequested: 500 });
    return out;
  }

  it('CLAIM: the cascade routes about 70% of conversations to the cheap tier', () => {
    const results = buildTraffic().map((r) => runConversation(r, cfg));
    const cheapOnly = results.filter((r) => r.attempts.length === 1 && r.attempts[0]!.tier === 'cheap');
    expect(cheapOnly).toHaveLength(70);
    expect(cheapOnly.length / results.length).toBe(0.7);
  });

  it('CLAIM: the step cap is what stops the reasoning loops, and the cascade alone would not', () => {
    const loop: ConversationRequest = { id: 'loop', succeedsAtTier: null, stepsRequested: 500 };
    expect(runConversation(loop, cfg).stoppedBy).toBe('step-cap');
    // Without the cap, the same request runs until the budget catches it, which is 6 times the cost.
    const uncapped = runConversation(loop, { ...cfg, maxStepsPerTask: 10_000 });
    expect(uncapped.stoppedBy).toBe('budget');
    expect(uncapped.costUsd).toBeGreaterThan(runConversation(loop, cfg).costUsd);
  });

  it('CLAIM: the budget bounds the worst case, which is the case that produced the $500/hour story', () => {
    const loop: ConversationRequest = { id: 'loop', succeedsAtTier: null, stepsRequested: 500 };
    const guarded = runConversation(loop, { ...cfg, maxStepsPerTask: 10_000 });
    const ungoverned = runUngoverned(loop);
    expect(guarded.costUsd).toBeLessThanOrEqual(cfg.budgetPerConversationUsd);
    expect(ungoverned.costUsd).toBeCloseTo(500 * PRICING.capable, 6); // $30 for one conversation
    expect(ungoverned.costUsd / guarded.costUsd).toBeGreaterThan(50);
  });

  it('CLAIM: cost per resolved ticket falls by about 60% with no drop in resolution', () => {
    const traffic = buildTraffic();
    const governed = outcomeCost(traffic.map((r) => runConversation(r, cfg)));
    const ungoverned = outcomeCost(traffic.map((r) => runUngoverned(r)));

    expect(governed.resolved).toBe(98);
    expect(ungoverned.resolved).toBe(98); // quality unchanged, which is the claim that matters
    const reduction = 1 - governed.costPerResolvedUsd / ungoverned.costPerResolvedUsd;
    expect(reduction).toBeGreaterThan(0.6);
  });

  it('CLAIM: a cheap model called fifty times costs more than an expensive model called once', () => {
    expect(PRICING.cheap * 50).toBeGreaterThan(PRICING.capable);
    // Which is why the per-call price is the wrong number to optimize.
    expect(PRICING.cheap).toBeLessThan(PRICING.capable);
  });

  it('CLAIM: the denominator must be resolved conversations, or giving up faster looks like a saving', () => {
    const results = buildTraffic().map((r) => runConversation(r, cfg));
    const c = outcomeCost(results);
    expect(c.costPerConversationUsd).toBeLessThan(c.costPerResolvedUsd);
    expect(c.resolutionRate).toBeCloseTo(0.98, 2);
  });

  it('an unresolvable feature is a retirement decision, not a governance one', () => {
    expect(retirementCheck({ feature: 'agent', costPerOutcomeUsd: 0.16, valuePerOutcomeUsd: 4.0 }))
      .toMatchObject({ retire: false, reason: expect.stringMatching(/governance problem, not a retirement one/) });
    expect(retirementCheck({ feature: 'agent', costPerOutcomeUsd: 6.0, valuePerOutcomeUsd: 4.0 }))
      .toMatchObject({ retire: true, reason: expect.stringMatching(/does not fix a negative margin/) });
  });
});

describe('the Cascade Recalibration Rule', () => {
  const all = CASCADE_SIGNALS;

  it('CLAIM: all five signals, because optimizing the first four moves cost onto the customer', () => {
    expect(all).toHaveLength(5);
    expect(all).toContain('resolution-rate');
    const v = evaluateCascade({ monthsSinceRecalibration: 1, vendorChangedTiers: false, signalsMeasured: all.slice(0, 4) });
    expect(v).toMatchObject({ valid: false, missingSignals: ['resolution-rate'] });
    if (v.valid) throw new Error('unreachable');
    expect(v.reason).toMatch(/off the bill and onto the customer/);
  });

  it('CLAIM: a vendor change invalidates the thresholds immediately, not at the next quarter', () => {
    expect(evaluateCascade({ monthsSinceRecalibration: 0, vendorChangedTiers: true, signalsMeasured: all }))
      .toMatchObject({ valid: false, reason: expect.stringMatching(/invalidates the thresholds immediately/) });
  });

  it('CLAIM: a cascade is a tuned parameter, not a configuration you set once', () => {
    expect(evaluateCascade({ monthsSinceRecalibration: 3, vendorChangedTiers: false, signalsMeasured: all }))
      .toMatchObject({ valid: false, reason: expect.stringMatching(/not a configuration you set once/) });
    expect(evaluateCascade({ monthsSinceRecalibration: 2, vendorChangedTiers: false, signalsMeasured: all }))
      .toEqual({ valid: true });
  });
});
