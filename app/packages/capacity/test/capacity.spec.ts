import { describe, expect, it } from 'vitest';
import {
  confirmResourceBound,
  crossover,
  decide,
  isResourceBound,
  type Bottleneck,
  type DecisionInput,
} from '../src/optimization-roi.js';
import {
  SHOPFLOW_INDEXING_CONTENTION,
  checkPhysicalSeparation,
  diagnose,
  validateBackgroundBudget,
  type Placement,
} from '../src/contention.js';
import {
  HEADROOM_CEILING,
  HEADROOM_FLOOR,
  MODEL_INVALIDATORS,
  assessHeadroom,
  assessModel,
  assessScalingReadiness,
} from '../src/capacity-model.js';
import {
  PERCEPTIBILITY_FLOOR_MS,
  SHOPFLOW_OPTIMIZATIONS,
  judge,
  nextStep,
  opportunityCost,
} from '../src/good-enough.js';

/**
 * ShopFlow at Chapter 13: $12,800/month of infrastructure, up 34% since Chapter 10 with no
 * corresponding revenue increase. Search p99 goes from 95ms to 210ms during indexing windows. Capacity
 * planning is reactive only.
 */

const base: DecisionInput = {
  meetingSlo: false,
  bottleneck: 'cpu',
  hardwareMonthlyDeltaUsd: 800,
  optimizationWeeks: 4,
  loadedWeeklyRateUsd: 5000,
};

describe('the Hardware-First Rule', () => {
  it('CLAIM: three of the five exits do not involve writing optimization code', () => {
    const exits = [
      decide({ ...base, meetingSlo: true }),
      decide({ ...base, bottleneck: 'lock-contention' }),
      decide(base),
      decide({ ...base, optimizationWeeks: 1 }),
      decide({ ...base, hardwareMonthlyDeltaUsd: null }),
    ];
    expect(new Set(exits.map((e) => e.exit)).size).toBe(5);
    expect(exits.filter((e) => !e.requiresOptimizationWork)).toHaveLength(2);
    // The third no-code outcome is accepting the cost, which is the provision exit's other half.
    expect(exits.filter((e) => e.requiresOptimizationWork)).toHaveLength(3);
  });

  it('CLAIM: question 1 ends it. Meeting the SLO is not a performance problem', () => {
    const d = decide({ ...base, meetingSlo: true });
    expect(d.exit).toBe('no-problem-only-a-preference');
    expect(d.reason).toMatch(/competing with the feature backlog/);
  });

  it('CLAIM: an algorithm-bound bottleneck skips the economics entirely', () => {
    // Hardware will not resolve it at any price, so there is nothing to compare.
    for (const b of ['quadratic-algorithm', 'lock-contention', 'query-plan', 'network-round-trips', 'serialisation-point'] as Bottleneck[]) {
      expect(isResourceBound(b)).toBe(false);
      expect(decide({ ...base, bottleneck: b }).exit).toBe('optimize-hardware-cannot-help');
    }
    for (const b of ['cpu', 'memory', 'iops'] as Bottleneck[]) {
      expect(isResourceBound(b)).toBe(true);
    }
  });

  it('CLAIM: ShopFlow indexing resolves to provision, on a 12-month test', () => {
    // $800/mo x 12 = $9,600 against 4 weeks at $5,000 = $20,000.
    const d = decide(base);
    expect(d.exit).toBe('provision-hardware');
    expect(d.twelveMonthHardwareUsd).toBe(9_600);
    expect(d.optimizationCostUsd).toBe(20_000);
  });

  it('optimizes when the hardware is the more expensive path', () => {
    expect(decide({ ...base, hardwareMonthlyDeltaUsd: 3000 }).exit).toBe('optimize-hardware-is-more-expensive');
  });

  it('CLAIM: with no hardware path, optimization is not the economic choice but the only one', () => {
    const d = decide({ ...base, hardwareMonthlyDeltaUsd: null });
    expect(d.exit).toBe('optimize-no-hardware-path-exists');
    expect(d.reason).toMatch(/it is the only choice/);
  });

  it('CLAIM: the Resource-Bound Precondition is empirical, not a category judgement', () => {
    // Doubling the box on an O(n^2) routine buys a 41% increase in workable n, not 100%.
    expect(confirmResourceBound({ capacityMultiple: 2, observedThroughputMultiple: 1.41 }).resourceBound).toBe(false);
    expect(confirmResourceBound({ capacityMultiple: 2, observedThroughputMultiple: 1.95 }).resourceBound).toBe(true);
    expect(confirmResourceBound({ capacityMultiple: 2, observedThroughputMultiple: 1.0 }).note)
      .toMatch(/not the resource you enlarged/);
  });
});

describe('the crossover figure the manuscript reads backwards', () => {
  const c = crossover({ recurringMonthlyUsd: 800, oneTimeUsd: 20_000 });

  it('CLAIM: $20,000 / $800 is 25 months, which is MORE than two years', () => {
    // The manuscript states this division correctly and then calls it "less than 2 years".
    expect(c.months).toBe(25);
    expect(c.months).toBeGreaterThan(24);
  });

  it('CLAIM: month 25 is when the recurring option STOPS being cheaper, not a payback date', () => {
    // Option A (dedicated node pool) is the recurring cost; Option B (optimize) is the one-time cost.
    // Nothing is paid back by the recurring option. A meter is running.
    expect(c.interpretation).toMatch(/STOPS being cheaper/);
    expect(c.interpretation).toMatch(/it accrues/);
  });

  it('CLAIM: the recommendation is still right, because the rule is a TWELVE-month test', () => {
    // This is why the rule is framed at 12 months: a 25-month crossover never has to be interpreted.
    expect(c.twelveMonthRecurringUsd).toBe(9_600);
    expect(c.cheaperAtTwelveMonths).toBe('recurring');
    expect(decide(base).exit).toBe('provision-hardware');
  });

  it('a cheap one-time fix crosses over almost immediately', () => {
    const quick = crossover({ recurringMonthlyUsd: 800, oneTimeUsd: 1_600 });
    expect(quick.months).toBe(2);
    expect(quick.cheaperAtTwelveMonths).toBe('one-time');
  });
});

describe('diagnosing resource contention', () => {
  it('CLAIM: ShopFlow is contention, and the degradation is 2.2x', () => {
    const d = diagnose(SHOPFLOW_INDEXING_CONTENTION);
    expect(d.verdict).toBe('contention');
    if (d.verdict !== 'contention') throw new Error('unreachable');
    expect(d.degradationMultiple).toBeCloseTo(2.21, 2);
    expect(d.p0HeadroomShare).toBeCloseTo(0.15, 2); // 15% of node CPU left for P0 search
    expect(d.fix).toMatch(/not a resource limit on the same one/);
  });

  it('CLAIM: step 2 decides everything. Risen P0 traffic makes it capacity, not contention', () => {
    // The step teams skip. Physical separation does not help a workload that needs more resource.
    const d = diagnose({ ...SHOPFLOW_INDEXING_CONTENTION, p0TrafficRatio: 1.8 });
    expect(d.verdict).toBe('capacity');
    if (d.verdict !== 'capacity') throw new Error('unreachable');
    expect(d.reason).toMatch(/physical separation will not help/);
  });

  it('CLAIM: one aligned occurrence is coincidence, not a correlation', () => {
    expect(diagnose({ ...SHOPFLOW_INDEXING_CONTENTION, repetitionsObserved: 1 }).verdict).toBe('inconclusive');
    expect(diagnose({ ...SHOPFLOW_INDEXING_CONTENTION, repetitionsObserved: 2 }).verdict).toBe('contention');
  });

  it('CLAIM: co-location must be confirmed before optimizing anything', () => {
    const d = diagnose({ ...SHOPFLOW_INDEXING_CONTENTION, coLocated: false });
    expect(d.verdict).toBe('inconclusive');
    if (d.verdict !== 'inconclusive') throw new Error('unreachable');
    expect(d.reason).toMatch(/engineering time spent on the wrong thing/);
  });

  it('an imprecise window correlates against nothing', () => {
    expect(diagnose({ ...SHOPFLOW_INDEXING_CONTENTION, windowStart: '' }).verdict).toBe('inconclusive');
  });
});

describe('the Physical Separation Rule, and why Option A and Option B are not comparable', () => {
  const shared: Placement[] = [
    { workload: 'search', tier: 'P0', nodePool: 'general-1', isolation: 'none', resourceShareAtPeak: 0.15 },
    { workload: 'code-indexing', tier: 'P2', nodePool: 'general-1', isolation: 'none', resourceShareAtPeak: 0.85 },
  ];

  it('CLAIM: the current placement violates the rule', () => {
    const v = checkPhysicalSeparation(shared);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ p0: 'search', p2: 'code-indexing', p2ShareAtPeak: 0.85 });
  });

  it('CLAIM: halving the P2 job (Option B) does NOT satisfy the rule', () => {
    // This is what makes the side-by-side dollar comparison misleading. Option B takes the indexing
    // job from 85% to ~43% and leaves a P0 and a P2 on the same physical compute. 43% of a shared
    // node is still enough to move a p99.
    const optimized = shared.map((p) =>
      p.workload === 'code-indexing' ? { ...p, resourceShareAtPeak: 0.425 } : p,
    );
    const v = checkPhysicalSeparation(optimized);
    expect(v).toHaveLength(1);
    expect(v[0]!.p2ShareAtPeak).toBe(0.425);
  });

  it('CLAIM: separating onto a dedicated pool (Option A) does satisfy it', () => {
    const separated: Placement[] = [
      { ...shared[0]!, nodePool: 'p0-dedicated', isolation: 'dedicated-nodes' },
      { ...shared[1]!, nodePool: 'p2-batch', isolation: 'dedicated-nodes' },
    ];
    expect(checkPhysicalSeparation(separated)).toEqual([]);
  });

  it('CLAIM: resource limits on a shared pool are not physical separation', () => {
    const limited = shared.map((p) => ({ ...p, isolation: 'resource-limits-shared-pool' as const }));
    const v = checkPhysicalSeparation(limited);
    expect(v).toHaveLength(1);
    expect(v[0]!.note).toMatch(/still takes IOPS, cache lines and scheduler time/);
  });

  it('the Background Budget Rule needs all four bounds, because three leaves one unbounded', () => {
    expect(validateBackgroundBudget({ job: 'code-indexing' })).toHaveLength(4);
    expect(
      validateBackgroundBudget({ job: 'code-indexing', maxCpuPercent: 40, maxMemoryMb: 8192, maxIops: 3000 }),
    ).toEqual(['maxExecutionWindowMinutes']);
    expect(
      validateBackgroundBudget({
        job: 'code-indexing',
        maxCpuPercent: 40,
        maxMemoryMb: 8192,
        maxIops: 3000,
        maxExecutionWindowMinutes: 90,
      }),
    ).toEqual([]);
  });
});

describe('the capacity headroom band', () => {
  it('CLAIM: the target band is 120 to 150% of measured peak', () => {
    expect(HEADROOM_FLOOR).toBe(1.2);
    expect(HEADROOM_CEILING).toBe(1.5);
    expect(assessHeadroom({ provisionedUnits: 130, measuredPeakUnits: 100, monthlyCostPerUnitUsd: 40 }).zone)
      .toBe('target-band');
  });

  it('CLAIM: below 120% is one traffic spike from an incident', () => {
    const a = assessHeadroom({ provisionedUnits: 110, measuredPeakUnits: 100, monthlyCostPerUnitUsd: 40 });
    expect(a.zone).toBe('under-provisioned');
    expect(a.note).toMatch(/one traffic spike/);
    expect(a.wasteAboveCeilingUsd).toBe(0);
  });

  it('CLAIM: above 150% is paying for capacity nobody uses, and it is quantifiable', () => {
    const a = assessHeadroom({ provisionedUnits: 200, measuredPeakUnits: 100, monthlyCostPerUnitUsd: 40 });
    expect(a.zone).toBe('over-provisioned');
    expect(a.wasteAboveCeilingUsd).toBe(2_000); // 50 units above the 150 ceiling, at $40
  });

  it('the band edges are inclusive, so exactly 120% and exactly 150% are in it', () => {
    for (const provisioned of [120, 150]) {
      expect(assessHeadroom({ provisionedUnits: provisioned, measuredPeakUnits: 100, monthlyCostPerUnitUsd: 40 }).zone)
        .toBe('target-band');
    }
  });
});

describe('model recalibration', () => {
  const ok = { predictedPeak: 100, observedPeak: 103 };

  it('CLAIM: an unchecked model of a quarter old is an assumption with a spreadsheet attached', () => {
    const v = assessModel({ monthsSinceLastCheck: 3, history: [ok, ok] });
    expect(v.trustworthy).toBe(false);
    if (v.trustworthy) throw new Error('unreachable');
    expect(v.reason).toMatch(/spreadsheet attached/);
  });

  it('CLAIM: a consistent gap in EITHER direction invalidates the model', () => {
    const under = assessModel({
      monthsSinceLastCheck: 1,
      history: [{ predictedPeak: 100, observedPeak: 140 }, { predictedPeak: 100, observedPeak: 135 }],
    });
    const over = assessModel({
      monthsSinceLastCheck: 1,
      history: [{ predictedPeak: 100, observedPeak: 70 }, { predictedPeak: 100, observedPeak: 65 }],
    });
    expect(under).toMatchObject({ trustworthy: false, direction: 'under' });
    expect(over).toMatchObject({ trustworthy: false, direction: 'over' });
    // Over-prediction is the one that gets forgiven, and it is buying idle capacity on a false premise.
    if (over.trustworthy) throw new Error('unreachable');
    expect(over.reason).toMatch(/idle capacity on a false premise/);
  });

  it('noise in both directions is not a signal', () => {
    const v = assessModel({
      monthsSinceLastCheck: 1,
      history: [{ predictedPeak: 100, observedPeak: 115 }, { predictedPeak: 100, observedPeak: 88 }],
    });
    expect(v.trustworthy).toBe(true);
  });

  it('four things invalidate a model faster than growth alone', () => {
    expect(MODEL_INVALIDATORS).toHaveLength(4);
    expect(MODEL_INVALIDATORS).toContain('feature-launch-changing-the-shape-of-peak');
  });
});

describe('scaling readiness', () => {
  const drilled = {
    service: 'checkout',
    tier: 'P0' as const,
    documented: true,
    scripted: true,
    lastExecutedDaysAgo: 30,
    measuredExecutionMinutes: 8,
  };

  it('a documented, scripted, recently drilled procedure is ready', () => {
    expect(assessScalingReadiness(drilled)).toEqual({ ready: true });
  });

  it('CLAIM: documented and scripted is not enough. It must have been RUN', () => {
    const v = assessScalingReadiness({ ...drilled, lastExecutedDaysAgo: null, measuredExecutionMinutes: null });
    expect(v).toMatchObject({ ready: false, reason: expect.stringMatching(/will fail at the worst moment/) });
  });

  it('CLAIM: a drill that is a quarter stale proved a different environment', () => {
    expect(assessScalingReadiness({ ...drilled, lastExecutedDaysAgo: 120 }))
      .toMatchObject({ ready: false, reason: expect.stringMatching(/is not the one it will run in/) });
  });

  it('CLAIM: scaling must complete in minutes, not hours', () => {
    expect(assessScalingReadiness({ ...drilled, measuredExecutionMinutes: 95 }))
      .toMatchObject({ ready: false, reason: expect.stringMatching(/minutes, not hours/) });
  });

  it('a manual procedure under pressure is a different procedure', () => {
    expect(assessScalingReadiness({ ...drilled, scripted: false }))
      .toMatchObject({ ready: false, reason: expect.stringMatching(/manual procedure under pressure/) });
  });
});

describe('good enough', () => {
  const [checkout, analytics, ranking] = SHOPFLOW_OPTIMIZATIONS as [
    (typeof SHOPFLOW_OPTIMIZATIONS)[number],
    (typeof SHOPFLOW_OPTIMIZATIONS)[number],
    (typeof SHOPFLOW_OPTIMIZATIONS)[number],
  ];

  it('CLAIM: the SMALLER percentage is the one worth doing', () => {
    const c = judge(checkout);
    const a = judge(analytics);
    expect(c.percentImprovement).toBeCloseTo(66.7, 1);
    expect(a.percentImprovement).toBeCloseTo(33.3, 1);
    // The larger percentage is the one to skip, which is why percentage is a benchmark metric.
    expect(c.worthDoing).toBe(true);
    expect(a.worthDoing).toBe(false);
  });

  it('CLAIM: checkout 900ms to 300ms is perceptible in every millisecond of it', () => {
    const c = judge(checkout);
    expect(c.absoluteSavingMs).toBe(600);
    expect(c.perceptible).toBe(true);
    expect(c.reason).toMatch(/outside its threshold/);
  });

  it('CLAIM: an hour off an overnight batch is 33% of nothing anyone experiences', () => {
    const a = judge(analytics);
    expect(a.absoluteSavingMs).toBe(3_600_000); // an entire hour, and still not worth doing
    expect(a.perceptible).toBe(false);
    // The batch is disqualified twice over: it is already inside its 24-hour SLO, AND nobody is
    // waiting on it. The cheaper reason is reported first, which is the right ordering.
    expect(a.alreadyGoodEnough).toBe(true);
    expect(a.reason).toMatch(/Perfection Trap/);

    // Tighten the SLO so the threshold no longer disqualifies it, and the second reason surfaces.
    const tightened = judge({ ...analytics, goodEnoughMs: 2.5 * 3_600_000 });
    expect(tightened.alreadyGoodEnough).toBe(false);
    expect(tightened.worthDoing).toBe(false);
    expect(tightened.reason).toMatch(/nobody is waiting/);
  });

  it('CLAIM: the search ranking model is already inside its threshold', () => {
    // 35ms against a 50ms good-enough threshold. The proposed 20ms is the Perfection Trap.
    const r = judge(ranking);
    expect(r.alreadyGoodEnough).toBe(true);
    expect(r.worthDoing).toBe(false);
    expect(r.reason).toMatch(/Perfection Trap/);
  });

  it('CLAIM: 15ms is below the perceptibility floor either way', () => {
    expect(PERCEPTIBILITY_FLOOR_MS).toBe(100);
    // Even with the threshold moved so it is not already good enough, the saving is invisible.
    const forced = judge({ ...ranking, goodEnoughMs: 25 });
    expect(forced.alreadyGoodEnough).toBe(false);
    expect(forced.perceptible).toBe(false);
    expect(forced.reason).toMatch(/Nobody can tell/);
  });

  it('CLAIM: the opportunity cost refuses to invent the other side of the comparison', () => {
    // The value of the feature those weeks would buy is the product team's number, not the
    // architect's. The chapter is explicit that this is the only comparison that matters.
    const oc = opportunityCost(ranking, 5000);
    expect(oc.costUsd).toBe(15_000);
    expect(oc.valueOfTheOptimizationUsd).toBe(0);
    expect(oc.comparison).toMatch(/product team's number to supply/);
  });

  it("the chapter's loaded rate reconciles across all three Manager's Math blocks", () => {
    // 4 weeks = $20,000 in the contention block; 3 weeks = $15,000 in the right-sizing and
    // good-enough blocks. That is $5,000/week in all three, which is the sort of thing that usually
    // does not hold across a chapter.
    expect(decide(base).optimizationCostUsd).toBe(20_000);
    expect(opportunityCost(ranking, 5000).costUsd).toBe(15_000);
    expect(opportunityCost(analytics, 5000).costUsd).toBe(15_000);
  });

  it('the iterative sequence is ship, observe, optimize', () => {
    expect(nextStep(0)).toBe('ship-at-good-enough');
    expect(nextStep(1)).toBe('optimize-on-real-usage');
    expect(nextStep(2)).toBe('fix-what-scale-exposed');
    expect(nextStep(3)).toBe('steady-state');
  });
});
