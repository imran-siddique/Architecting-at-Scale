import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_JOURNEY,
  OUTCOME_METRICS,
  assessHealth,
  firstTwoMetrics,
  type RequestOutcome,
} from '../src/journey.js';
import {
  CHECKOUT_HOPS,
  looksComplete,
  propagate,
} from '../src/trace-propagation.js';
import {
  MIN_EVIDENCE_DAYS,
  TRUST_LADDER,
  assessTriageLoad,
  evaluateSuppression,
  mayEnableNextRung,
  recoveredCapacity,
} from '../src/alerting.js';

/**
 * ShopFlow at Chapter 11: infrastructure availability 99.9%, user-journey success 99.7%, 400 alerts
 * an hour of which 10 to 15% are actionable, 50TB of logs a day, MTTR four hours.
 */

/** 1,000 checkout journeys. Three fail silently: every request responded, no order arrived. */
function buildOutcomes(): RequestOutcome[] {
  const out: RequestOutcome[] = [];
  for (let j = 0; j < 1000; j++) {
    const silent = j < 3; // the 0.3%
    for (const step of CHECKOUT_JOURNEY.requiredSteps) {
      const isLastStep = step === 'confirm-order';
      out.push({
        journeyId: `j-${j}`,
        step,
        serviceResponded: true,
        httpOk: true,
        // A silent failure: the confirm step returned 200 and achieved nothing.
        outcomeAchieved: silent && isLastStep ? false : true,
      });
    }
  }
  return out;
}

describe('the gap between infrastructure health and journey success', () => {
  const report = assessHealth(buildOutcomes(), CHECKOUT_JOURNEY);

  it('CLAIM: infrastructure availability reads 100% while journeys are failing', () => {
    // Every service responded, every response was a 2xx. This is the green dashboard.
    expect(report.infrastructureAvailability).toBe(1);
    expect(report.httpSuccessRate).toBe(1);
  });

  it('CLAIM: journey success is lower, and the difference is the silent-failure floor', () => {
    expect(report.journeySuccessRate).toBeCloseTo(0.997, 4);
    expect(report.silentFailureRate).toBeCloseTo(0.003, 4);
    expect(report.infrastructureAvailability - report.journeySuccessRate).toBeCloseTo(0.003, 4);
  });

  it('CLAIM: these failures are invisible to infrastructure monitoring BY CONSTRUCTION', () => {
    // Not hard to see. Impossible to see, from a monitor that asks whether services responded.
    expect(report.silentlyFailedJourneys).toEqual(['j-0', 'j-1', 'j-2']);
    for (const id of report.silentlyFailedJourneys) {
      expect(report.infrastructureAvailability).toBe(1); // nothing in the infra signal moved
    }
  });

  it('a visible failure shows up in both numbers, which is why it never went undetected', () => {
    const outcomes = buildOutcomes().map((o) =>
      o.journeyId === 'j-500' && o.step === 'authorize-payment'
        ? { ...o, serviceResponded: false, httpOk: false, outcomeAchieved: false }
        : o,
    );
    const r = assessHealth(outcomes, CHECKOUT_JOURNEY);
    expect(r.infrastructureAvailability).toBeLessThan(1);
    expect(r.silentlyFailedJourneys).not.toContain('j-500'); // it was never silent
  });

  it('the First Two Metrics Rule allows exactly two', () => {
    expect(firstTwoMetrics().map((m) => m.name))
      .toEqual(['checkout-completion-rate', 'payment-confirmation-rate']);

    const greedy = OUTCOME_METRICS.map((m) => ({ ...m, firstTwo: true }));
    expect(() => firstTwoMetrics(greedy)).toThrow(/the rule is TWO metrics/);
  });
});

describe('correlation ID propagation, and where the silent failure hid', () => {
  it('CLAIM: header-only propagation survives every SYNC hop and dies at the async one', () => {
    const r = propagate(CHECKOUT_HOPS, 'corr-abc12345', 'header-only');

    expect(r.reachedHops).toEqual([1, 2, 3, 4, 5]);
    expect(r.lostAtHop).toBe(6); // the broker, exactly where the silent failure lives
  });

  it('CLAIM: a trace that stops is indistinguishable from a request that finished', () => {
    // This is why the 0.3% went undetected. Nothing alerted, because from the tracing backend's
    // point of view those journeys ended normally at hop 5.
    const r = propagate(CHECKOUT_HOPS, 'corr-abc12345', 'header-only');
    expect(looksComplete(r, CHECKOUT_HOPS.length)).toBe(true);
  });

  it('CLAIM: putting the ID in the PAYLOAD survives the broker', () => {
    const r = propagate(CHECKOUT_HOPS, 'corr-abc12345', 'header-and-payload');
    expect(r.reachedHops).toContain(6);
    // Hop 7 is external and still needs the registry, which is a different problem.
    expect(r.lostAtHop).toBe(7);
  });

  it('CLAIM: the external hop needs a registry, not a header', () => {
    const registry = new Map<string, string>();
    const r = propagate(CHECKOUT_HOPS, 'corr-abc12345', 'header-and-payload', registry);

    expect(r.lostAtHop).toBeNull();          // survives all seven
    expect(r.bridgedHops).toEqual([7]);
    expect([...registry.values()]).toEqual(['corr-abc12345']);
  });

  it('the naive version passes any test that only exercises synchronous calls', () => {
    // Which is exactly how it shipped. A suite of sync hops gives it a clean bill of health.
    const syncOnly = CHECKOUT_HOPS.filter((h) => h.kind === 'sync');
    const r = propagate(syncOnly, 'corr-abc12345', 'header-only');
    expect(r.lostAtHop).toBeNull();
  });
});

describe('the alert arithmetic that was wrong', () => {
  const load = { alertsPerHour: 400, minutesPerTriage: 8, actionableFraction: 0.125 };

  it('CLAIM: 400 alerts/hour at 8 minutes is 53 engineer-hours of triage PER HOUR', () => {
    const f = assessTriageLoad(load);
    expect(f.engineerHoursPerHour).toBeCloseTo(53.3, 1);
  });

  it('CLAIM: which means 53 FULL-TIME ENGINEERS, and that is the sanity check that was missing', () => {
    // The manuscript originally called the recovered 48 engineer-hours per hour "six engineers'
    // full working capacity". 48 engineer-hours per hour is 48 FTE, off by roughly an order of
    // magnitude. Stating the unit conversion makes the error impossible to repeat.
    const f = assessTriageLoad(load);
    expect(f.impliedFullTimeEngineers).toBeCloseTo(53.3, 1);
    expect(f.unprocessable).toBe(true);
    expect(f.interpretation).toMatch(/That is the finding/);
  });

  it('CLAIM: the volume being unprocessable is WHY the actionable alerts are ignored too', () => {
    const f = assessTriageLoad(load);
    expect(f.interpretation).toMatch(/are being ignored with the rest/);
  });

  it('recovered capacity is measured against the rotation, not the theoretical triage cost', () => {
    // Six engineers, ~5 on-call days each per month, ~3 hours of triage per on-call day, and a 90%
    // alert reduction. That is about half an FTE, on the order of $90,000 a year, rather than the
    // $480,000 to $600,000 the original figure implied.
    const r = recoveredCapacity(
      { engineersOnRotation: 6, onCallDaysPerEngineerPerMonth: 5, triageHoursPerOnCallDay: 3 },
      0.9,
    );
    expect(r.engineerHoursPerMonthLost).toBe(90);
    expect(r.engineerHoursPerMonthRecovered).toBe(81);
    expect(r.fullTimeEquivalent).toBeCloseTo(0.51, 2);
    expect(r.annualValueUsd).toBeGreaterThan(80_000);
    expect(r.annualValueUsd).toBeLessThan(100_000);
  });

  it('a manageable volume is reported as such rather than alarmed about', () => {
    expect(assessTriageLoad({ alertsPerHour: 40, minutesPerTriage: 5, actionableFraction: 1 }).unprocessable)
      .toBe(false);
  });
});

describe('the Rationalization Ratchet', () => {
  const base = {
    category: 'disk-usage-warning',
    daysOfEvidence: 30,
    firedCount: 4000,
    actionedCount: 0,
    alreadySuppressedThisCycle: [] as string[],
    previousCycleValidated: true,
  };

  it('allows a well-evidenced suppression', () => {
    expect(evaluateSuppression(base)).toEqual({ allow: true });
  });

  it('CLAIM: refuses without 30 days of evidence, because a quiet week may be seasonal', () => {
    expect(evaluateSuppression({ ...base, daysOfEvidence: 7 }))
      .toMatchObject({ allow: false, reason: 'insufficient-evidence' });
    expect(MIN_EVIDENCE_DAYS).toBe(30);
  });

  it('CLAIM: refuses a second suppression in the same cycle', () => {
    // Two at once means a missed incident cannot be attributed to either.
    expect(evaluateSuppression({ ...base, alreadySuppressedThisCycle: ['cpu-spike'] }))
      .toMatchObject({ allow: false, reason: 'more-than-one-per-cycle' });
  });

  it('refuses until the previous cycle has been validated', () => {
    expect(evaluateSuppression({ ...base, previousCycleValidated: false }))
      .toMatchObject({ allow: false, reason: 'previous-not-validated' });
  });

  it('refuses a category that anyone actually acted on', () => {
    expect(evaluateSuppression({ ...base, actionedCount: 12 }))
      .toMatchObject({ allow: false, reason: 'still-actionable' });
  });
});

describe('the Automation Trust Ladder', () => {
  it('starts at diagnose-and-report, whose blast radius is nothing', () => {
    expect(TRUST_LADDER[0]).toMatchObject({ level: 1, blastRadius: 'none: it writes a summary' });
    expect(mayEnableNextRung({ highestEnabled: 0, unattendedDaysAtCurrent: 0, interventionsAtCurrent: 0 }).allow)
      .toBe(true);
  });

  it('CLAIM: a rung must run unattended for its full period before the next is enabled', () => {
    expect(mayEnableNextRung({ highestEnabled: 1, unattendedDaysAtCurrent: 10, interventionsAtCurrent: 0 }))
      .toMatchObject({ allow: false });
    expect(mayEnableNextRung({ highestEnabled: 1, unattendedDaysAtCurrent: 14, interventionsAtCurrent: 0 }).allow)
      .toBe(true);
  });

  it('CLAIM: any intervention resets the count, because it did not run unattended', () => {
    expect(mayEnableNextRung({ highestEnabled: 2, unattendedDaysAtCurrent: 90, interventionsAtCurrent: 1 }))
      .toMatchObject({ allow: false, reason: expect.stringMatching(/count restarts/) });
  });

  it('the highest rung requires the longest proof, because it changes state', () => {
    expect(TRUST_LADDER[2]!.unattendedDaysRequired).toBe(90);
    expect(mayEnableNextRung({ highestEnabled: 3, unattendedDaysAtCurrent: 999, interventionsAtCurrent: 0 }).allow)
      .toBe(false);
  });
});
