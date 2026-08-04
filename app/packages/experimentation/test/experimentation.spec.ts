import { describe, expect, it } from 'vitest';
import {
  PROGRESSION,
  SHOPFLOW_STAGE,
  attemptStage,
  capabilitiesAt,
  forcingFunctions,
} from '../src/maturity.js';
import {
  FLAG_VS_CONFIG,
  LIFECYCLE_STAGES,
  UNOWNED_FAILURE,
  classify,
  createFlag,
  planCleanup,
  reasoningTax,
  type Flag,
} from '../src/flags.js';
import {
  MAX_CHANGE_FAILURE_RATE,
  SHOPFLOW_DELIVERY,
  SHOPFLOW_HEALTH,
  assessFitness,
  firstMetricToAttack,
  iterationGap,
} from '../src/delivery-fitness.js';
import {
  IDENTICAL_UNIT,
  TUNED_UNIT,
  assessBoundary,
  compareStrategies,
  decide,
  pace,
  plan,
  type ExperimentDesign,
} from '../src/architectural-experiments.js';

/**
 * ShopFlow at Chapter 16: nothing is broken, and that is the problem. One deploy a month (from one a day),
 * three-week lead time, 22% change failure rate, 180-plus flags, seven months since the architecture last
 * moved, zero experiments running. Panic Meter 2 out of 10, which is the wrong kind of calm.
 */

describe('the experimentation progression', () => {
  it('CLAIM: each stage supplies what the next one requires', () => {
    expect(PROGRESSION).toHaveLength(6);
    for (let i = 1; i < PROGRESSION.length; i++) {
      expect(PROGRESSION[i]!.requires).toBe(PROGRESSION[i - 1]!.stage);
    }
    expect(PROGRESSION[0]!.requires).toBeNull();
  });

  it('CLAIM: flags without a canary buy the ability to hide unfinished work and none of the ability to measure', () => {
    // This is ShopFlow's exact position, and it is the row that explains the graveyard.
    const c = capabilitiesAt(2);
    expect(c.canShipDark).toBe(true);
    expect(c.canMeasureOnASlice).toBe(false);
    expect(SHOPFLOW_STAGE).toBe(2);
  });

  it('CLAIM: skipping a stage produces the appearance of the capability without the mechanism', () => {
    expect(attemptStage(2, 3).sound).toBe(true); // the next stage is always available
    const v = attemptStage(2, 5);
    expect(v.sound).toBe(false);
    if (v.sound) throw new Error('unreachable');
    expect(v.missing).toEqual([3, 4]);
    expect(v.appearanceOf).toBe('architectural experiments');
    expect(v.reason).toMatch(/without the mechanism underneath it/);
  });

  it('CLAIM: stage 2 stalls because the forcing functions live downstream of it', () => {
    // Not a discipline problem. A team that stops at flags has removed its own forcing function.
    const at2 = forcingFunctions(2);
    expect(at2.present).toEqual([]);
    expect(at2.absent).toHaveLength(2);

    const at4 = forcingFunctions(4);
    expect(at4.absent).toEqual([]);
    expect(at4.present[0]).toMatch(/measurement ending the experiment/);
  });

  it('automated rollback is the stage that removes the personal risk', () => {
    expect(PROGRESSION[3]!.supplies).toMatch(/removal of personal risk, and therefore of the fear/);
  });
});

describe('flags versus configuration', () => {
  const good: Flag = {
    key: 'new-checkout-summary',
    hypothesis: 'the condensed summary raises completion',
    expiryIso: '2026-09-15',
    ownerService: 'checkout',
    rolloutPercent: 10,
    gatedPaths: ['checkout/summary.ts'],
    createdIso: '2026-08-01',
  };

  it('CLAIM: they differ in lifetime and in purpose, across four properties', () => {
    expect(FLAG_VS_CONFIG).toHaveLength(4);
    expect(FLAG_VS_CONFIG.find((r) => r.property === 'end-state')!.flag).toMatch(/removed/);
    expect(FLAG_VS_CONFIG.find((r) => r.property === 'end-state')!.config).toMatch(/it is the setting/);
  });

  it('CLAIM: a flag with no expiry was never an experiment', () => {
    expect(createFlag({ ...good, expiryIso: null })).toMatchObject({
      accept: false,
      reason: /permanent fork introduced by accident/,
    });
  });

  it('CLAIM: an unowned flag is an unremovable flag', () => {
    expect(createFlag({ ...good, ownerService: null })).toMatchObject({
      accept: false,
      reason: /nobody is accountable for remembering/,
    });
  });

  it('CLAIM: ownership attaches to the service, so it transfers when the service does', () => {
    // The field is the service, not a person. There is no way to record an individual, which is the point.
    expect(good.ownerService).toBe('checkout');
    expect(createFlag(good)).toEqual({ accept: true });
  });

  it('a flag with no hypothesis cannot be resolved, because nothing says what resolving means', () => {
    expect(createFlag({ ...good, hypothesis: '  ' })).toMatchObject({ accept: false });
  });

  it('all five lifecycle stages have a named failure mode when unowned', () => {
    expect(LIFECYCLE_STAGES).toHaveLength(5);
    for (const s of LIFECYCLE_STAGES) expect(UNOWNED_FAILURE[s].length).toBeGreaterThan(20);
    expect(UNOWNED_FAILURE.resolution).toMatch(/passes silently and the flag becomes permanent by default/);
    expect(UNOWNED_FAILURE.rollout).toMatch(/100% on the day it ships/);
  });

  it('classifies the four states a flag can be in', () => {
    const today = '2026-08-03';
    expect(classify(good, today)).toBe('active');
    expect(classify({ ...good, expiryIso: '2025-01-01' }, today)).toBe('expired');
    expect(classify({ ...good, expiryIso: '2025-01-01', rolloutPercent: 100 }, today)).toBe('abandoned-at-100');
    expect(classify({ ...good, rolloutPercent: 0 }, today)).toBe('never-rolled-out');
  });
});

describe('the graveyard, and where its cost actually is', () => {
  /** 180 flags: 12 active, the rest expired, some abandoned at 100% and some never rolled out. */
  function graveyard(): Flag[] {
    const out: Flag[] = [];
    for (let i = 0; i < 12; i++) {
      out.push({
        key: `active-${i}`,
        hypothesis: 'h',
        expiryIso: '2026-12-01',
        ownerService: 'checkout',
        rolloutPercent: 25,
        gatedPaths: [`checkout/path-${i % 3}.ts`],
        createdIso: '2026-07-01',
      });
    }
    for (let i = 0; i < 150; i++) {
      out.push({
        key: `expired-${i}`,
        hypothesis: 'h',
        expiryIso: '2025-03-01',
        ownerService: 'checkout',
        rolloutPercent: 50,
        gatedPaths: [`checkout/path-${i % 3}.ts`],
        createdIso: '2024-11-01',
      });
    }
    for (let i = 0; i < 15; i++) {
      out.push({
        key: `abandoned-${i}`,
        hypothesis: 'h',
        expiryIso: '2025-03-01',
        ownerService: null,
        rolloutPercent: 100,
        gatedPaths: [`checkout/path-${i % 3}.ts`],
        createdIso: '2024-11-01',
      });
    }
    for (let i = 0; i < 5; i++) {
      out.push({
        key: `never-${i}`,
        hypothesis: 'h',
        expiryIso: '2026-12-01',
        ownerService: null,
        rolloutPercent: 0,
        gatedPaths: [`checkout/path-${i % 3}.ts`],
        createdIso: '2025-06-01',
      });
    }
    return out;
  }

  it('CLAIM: 180-plus flags, most of them expired', () => {
    const flags = graveyard();
    expect(flags.length).toBeGreaterThanOrEqual(180);
    const p = planCleanup(flags, '2026-08-03');
    expect(p.keep).toHaveLength(12);
    expect(p.mechanicalDeletions.length + p.requiresJudgement.length).toBeGreaterThan(160);
  });

  it('CLAIM: the 2^n bound is not the number anyone pays', () => {
    // 2^182 is about 6e54, which is more combinations than there are atoms in the Earth. It is a true
    // bound and a useless one. The number that inflates a one-line fix is per-path.
    const t = reasoningTax(graveyard());
    expect(t.theoreticalPathBound).toBeGreaterThan(1e50);
    expect(t.worstCasePathsPerChange).toBeLessThan(t.theoreticalPathBound);
    expect(t.note).toMatch(/is not the number anyone pays/);
  });

  it('CLAIM: the cost is the reasoning burden per path, and it is still enormous', () => {
    const t = reasoningTax(graveyard());
    // 182 flags spread over 3 paths is ~61 flags gating the busiest one.
    expect(t.meanFlagsPerPath).toBeGreaterThan(55);
    expect(t.worstCasePathsPerChange).toBeGreaterThan(1e18);
  });

  it('CLAIM: a dozen time-boxed flags is a practice, not a graveyard', () => {
    const t = reasoningTax(graveyard().slice(0, 12));
    expect(t.liveFlagCount).toBe(12);
    expect(t.worstCasePathsPerChange).toBeLessThanOrEqual(32); // 4 flags on the busiest path
  });

  it('CLAIM: the cleanup is a sprint because most of it is deletion, not adjudication', () => {
    // The decision was already made when the expiry passed.
    const p = planCleanup(graveyard(), '2026-08-03');
    expect(p.mechanicalDeletions).toHaveLength(150);
    expect(p.requiresJudgement).toHaveLength(20); // 15 abandoned at 100%, 5 never rolled out
    expect(p.note).toMatch(/deletion rather than adjudication/);
  });
});

describe('delivery metrics as evolutionary fitness', () => {
  it('CLAIM: green health metrics with bad delivery is not healthy, it is stagnant', () => {
    const a = assessFitness(SHOPFLOW_HEALTH, SHOPFLOW_DELIVERY);
    expect(a.healthLooksGood).toBe(true);
    expect(a.deliveryLooksGood).toBe(false);
    expect(a.verdict).toBe('stagnant');
    expect(a.note).toMatch(/stays invisible until you measure the right thing/);
  });

  it('the four verdicts are distinguishable, so stagnant is not a synonym for unhealthy', () => {
    const goodDelivery = { deploymentsPerMonth: 30, leadTimeDays: 1, changeFailureRate: 0.05, timeToRestoreHours: 0.5 };
    const badHealth = { ...SHOPFLOW_HEALTH, slosMet: false, availability: 0.98 };
    expect(assessFitness(SHOPFLOW_HEALTH, goodDelivery).verdict).toBe('healthy');
    expect(assessFitness(badHealth, goodDelivery).verdict).toBe('unstable');
    expect(assessFitness(badHealth, SHOPFLOW_DELIVERY).verdict).toBe('failing');
  });

  it('CLAIM: a competitor shipping weekly iterates about four times per ShopFlow release', () => {
    const g = iterationGap(1, 4.33);
    expect(g.cyclesPerOurs).toBeCloseTo(4.3, 1);
    expect(g.ourCyclesPerYear).toBe(12);
    expect(Math.round(g.theirCyclesPerYear)).toBe(52);
  });

  it('CLAIM: the gap is in learning cycles, which is why shipping harder later does not close it', () => {
    expect(iterationGap(1, 4.33).note).toMatch(/A feature gap closes by shipping more; a learning gap does not/);
  });

  it('CLAIM: deployment frequency is an OUTCOME, so it is the wrong thing to attack first', () => {
    // The intuitive answer is frequency. A team at 22% failure and three weeks of lead time cannot deploy
    // weekly by deciding to.
    const f = firstMetricToAttack(SHOPFLOW_DELIVERY);
    expect(f.metric).toBe('changeFailureRate');
    expect(f.reason).toMatch(/caution is what produced the release window/);
    expect(SHOPFLOW_DELIVERY.changeFailureRate).toBeGreaterThan(MAX_CHANGE_FAILURE_RATE);
  });

  it('once the machinery is sound, frequency becomes a choice', () => {
    const f = firstMetricToAttack({ deploymentsPerMonth: 1, leadTimeDays: 2, changeFailureRate: 0.04, timeToRestoreHours: 0.5 });
    expect(f.metric).toBe('deploymentsPerMonth');
    expect(f.reason).toMatch(/frequency is now a choice/);
  });
});

describe('the predictable unit, with the arithmetic the chapter leaves out', () => {
  const demandRps = 8_000;
  const c = compareStrategies(TUNED_UNIT, IDENTICAL_UNIT, demandRps);

  it('CLAIM: the tuned unit really is faster on average, which is what makes it a trade', () => {
    expect(c.tunedUnitIsFasterOnAverage).toBe(true);
    expect(TUNED_UNIT.meanCapacityRps).toBeGreaterThan(IDENTICAL_UNIT.meanCapacityRps);
  });

  it('CLAIM: a predictable unit carries NO variance buffer, and that is the whole argument', () => {
    expect(c.scaleOut.varianceBufferUnits).toBe(0);
    expect(c.scaleOut.varianceBufferCostUsd).toBe(0);
    expect(c.scaleOut.dependableCapacityRps).toBe(IDENTICAL_UNIT.meanCapacityRps);
  });

  it('CLAIM: the tuned unit must be provisioned against its bad case, not its mean', () => {
    // 1,400 mean with 320 of standard deviation is 873 you can count on at the p5 level.
    expect(c.scaleUp.dependableCapacityRps).toBeCloseTo(872, 0);
    expect(c.scaleUp.varianceBufferUnits).toBeGreaterThan(0);
  });

  it('CLAIM: the measurable win is the eliminated over-provisioning, not raw speed', () => {
    // The chapter states this without numbers. These are the numbers.
    expect(c.cheaperStrategy).toBe('scale-out');
    expect(c.monthlySavingUsd).toBeGreaterThan(0);
    expect(c.note).toMatch(/the variance buffer is paid every month and the peak is not/);
  });

  it('CLAIM: variance is the dominant cost, roughly 7x the price-per-capacity difference', () => {
    // Removing the variance and changing nothing else isolates the mechanism. Two effects push the same
    // way here and this separates them: the tuned unit is also slightly worse per unit of capacity
    // ($0.443/rps against $0.420/rps), and that is the small half of the gap.
    const predictableTuned = { ...TUNED_UNIT, capacityStdDevRps: 0 };
    const withVariance = plan(TUNED_UNIT, demandRps);
    const withoutVariance = plan(predictableTuned, demandRps);

    const varianceCost = withVariance.monthlyCostUsd - withoutVariance.monthlyCostUsd;
    const pricePerCapacityCost = withoutVariance.monthlyCostUsd - c.scaleOut.monthlyCostUsd;

    expect(varianceCost).toBe(2_480);
    expect(pricePerCapacityCost).toBe(360);
    expect(varianceCost / pricePerCapacityCost).toBeGreaterThan(6);
  });

  it('the plan is against a confidence level, and a tighter one costs more units', () => {
    const p5 = plan(TUNED_UNIT, demandRps, 1.65);
    const p1 = plan(TUNED_UNIT, demandRps, 2.33);
    expect(p1.unitsRequired).toBeGreaterThan(p5.unitsRequired);
  });
});

describe('abandonment conditions', () => {
  const design: ExperimentDesign = {
    hypothesis: 'a document store lowers read latency for the catalog',
    // Metrics are normalized so that higher is better, which keeps the threshold arithmetic in one direction.
    mustImprove: [{ metric: 'catalogReadsPerSecond', byAtLeast: 0.3 }],
    mustNotRegress: [{ metric: 'writeThroughput', toleranceFraction: 0.05 }],
    statedBeforeStart: true,
  };

  it('CLAIM: without a pre-stated condition the decision goes to whoever invested most effort', () => {
    const v = decide({ ...design, statedBeforeStart: false }, { measured: {} });
    expect(v.outcome).toBe('undecidable');
    if (v.outcome !== 'undecidable') throw new Error('unreachable');
    expect(v.reason).toMatch(/the opposite of deciding on evidence/);
  });

  it('CLAIM: an experiment that validates the existing design is a SUCCESSFUL experiment', () => {
    // It cost a canary instead of a migration. Recording it as a failure teaches the team not to run the
    // cheap check, which is the expensive mistake.
    const v = decide(design, {
      measured: {
        catalogReadsPerSecond: { before: 100, after: 108 }, // improved 8%, needed 30%
        writeThroughput: { before: 1000, after: 1000 },
      },
    });
    expect(v.outcome).toBe('abandon');
    if (v.outcome !== 'abandon') throw new Error('unreachable');
    expect(v.validatedExistingDesign).toBe(true);
    expect(v.whatItCost).toMatch(/a canary instead of a migration/);
  });

  it('a regression is a different kind of abandon from a shortfall', () => {
    const v = decide(design, {
      measured: {
        catalogReadsPerSecond: { before: 100, after: 200 },
        writeThroughput: { before: 1000, after: 800 }, // regressed 20%
      },
    });
    expect(v.outcome).toBe('abandon');
    if (v.outcome !== 'abandon') throw new Error('unreachable');
    expect(v.validatedExistingDesign).toBe(false);
    expect(v.reason).toMatch(/writeThroughput regressed/);
  });

  it('a declared metric that was not measured is undecidable, not a pass', () => {
    expect(decide(design, { measured: { catalogReadsPerSecond: { before: 100, after: 200 } } }).outcome).toBe('undecidable');
  });

  it('adopts when the improvement clears and nothing regresses', () => {
    const v = decide(design, {
      measured: {
        catalogReadsPerSecond: { before: 100, after: 140 },
        writeThroughput: { before: 1000, after: 990 },
      },
    });
    expect(v.outcome).toBe('adopt');
  });
});

describe('reversible bets and future-proof boundaries', () => {
  it('CLAIM: the machinery is what makes a bet reversible, not the change', () => {
    // Same change, two teams. This is the thread back to the maturity progression.
    const change = { name: 'new ranking weights', revertibleByMachinery: true, writesIrreversibleState: false };
    expect(pace(change, true)).toMatchObject({ pace: 'fast' });
    expect(pace(change, false)).toMatchObject({ pace: 'careful', reason: /reversible in principle and not in practice/ });
  });

  it('CLAIM: no amount of machinery makes an irreversible write reversible', () => {
    const migration = { name: 'drop the legacy column', revertibleByMachinery: false, writesIrreversibleState: true };
    expect(pace(migration, true)).toMatchObject({ pace: 'careful', reason: /No amount of machinery/ });
  });

  it('CLAIM: a control that assumes a careful operator is a convention, not a gate', () => {
    // The same distinction as Chapter 15's runtime-versus-prompt, one layer up.
    expect(assessBoundary({ name: 'schema review', currentImplementation: 'MySQL', enforcedStructurally: false, assumesCarefulOperator: false }))
      .toMatchObject({ futureProof: false, reason: /holds until someone does not follow it/ });
    expect(assessBoundary({ name: 'migration gate', currentImplementation: 'MySQL', enforcedStructurally: true, assumesCarefulOperator: true }))
      .toMatchObject({ futureProof: false, reason: /the operator you cannot vet in advance/ });
  });

  it('CLAIM: the future-proof part is the boundary, and the contents will be replaced', () => {
    const b = assessBoundary({
      name: 'the data-access contract',
      currentImplementation: 'MySQL',
      enforcedStructurally: true,
      assumesCarefulOperator: false,
    });
    expect(b.futureProof).toBe(true);
    expect(b.reason).toMatch(/which will be replaced/);
  });
});
