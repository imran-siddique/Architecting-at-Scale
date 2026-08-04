/**
 * The five-rung chaos progression and the Experiment Progression Rule.
 *
 * The rule: you may not run an experiment at rung N+1 until every rung up to N has run in production
 * with no customer-visible impact. The reason is not caution for its own sake. An experiment that
 * causes an incident teaches the organization that chaos engineering causes incidents, and the
 * programme ends. The progression is what buys the credibility to keep going.
 *
 * The second constraint is the abort condition. An experiment without one is not an experiment, it is
 * an outage you scheduled. Every rung declares what it watches and the threshold at which it stops.
 */

export interface Rung {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  experiment: string;
  /** What the experiment is meant to prove. */
  hypothesis: string;
  /** The signal watched during the run, and the value that aborts it. */
  abortOn: string;
  /** Clean production runs required before the next rung unlocks. */
  cleanRunsRequired: number;
}

export const CHAOS_RUNGS: readonly Rung[] = [
  {
    level: 1,
    name: 'latency injection in staging',
    experiment: 'add 500ms to the recommendations call in staging',
    hypothesis: 'the timeout fires and the module is hidden rather than blocking the page',
    abortOn: 'staging page render exceeds 3s',
    cleanRunsRequired: 3,
  },
  {
    level: 2,
    name: 'dependency failure in staging',
    experiment: 'return errors from the pricing service in staging',
    hypothesis: 'the breaker opens and cached pricing serves',
    abortOn: 'any checkout completes with a price nobody can account for',
    cleanRunsRequired: 3,
  },
  {
    level: 3,
    name: 'single-instance failure in production',
    experiment: 'pod kill of one catalog instance during business hours',
    hypothesis: 'traffic drains in under 30s with no elevated error rate',
    abortOn: 'journey success drops below 99.5%',
    cleanRunsRequired: 5,
  },
  {
    level: 4,
    name: 'dependency degradation in production',
    experiment: 'inject 2s latency into 5% of recommendation calls in production',
    hypothesis: 'the timeout budget holds and checkout latency is unaffected',
    abortOn: 'p99 checkout latency rises more than 10%',
    cleanRunsRequired: 5,
  },
  {
    level: 5,
    name: 'zone loss in production',
    experiment: 'remove one availability zone from the load balancer',
    hypothesis: 'the remaining zones absorb the traffic inside their headroom',
    abortOn: 'any remaining zone exceeds 75% utilization',
    cleanRunsRequired: 1,
  },
];

export interface RungHistory {
  level: number;
  productionRunsClean: number;
  /** A run that caused customer-visible impact. Resets the progression at this rung. */
  runsWithCustomerImpact: number;
}

export type ProgressionVerdict = { allow: true; rung: Rung } | { allow: false; reason: string };

/**
 * May we run at `targetLevel`?
 *
 * Note what this deliberately does NOT allow: skipping a rung because a lower one seems obvious. The
 * lower rungs are cheap and their value is the track record, not the finding.
 */
export function mayRunAt(targetLevel: number, history: RungHistory[]): ProgressionVerdict {
  const rung = CHAOS_RUNGS.find((r) => r.level === targetLevel);
  if (!rung) return { allow: false, reason: `no rung ${targetLevel} defined` };

  for (const lower of CHAOS_RUNGS.filter((r) => r.level < targetLevel)) {
    const h = history.find((x) => x.level === lower.level);
    if (!h) {
      return { allow: false, reason: `rung ${lower.level} (${lower.name}) has never been run` };
    }
    if (h.runsWithCustomerImpact > 0) {
      return {
        allow: false,
        reason:
          `rung ${lower.level} caused customer-visible impact. Fix what it found and re-establish a ` +
          `clean record there before going higher: an experiment that causes an incident teaches the ` +
          `organization that chaos engineering causes incidents.`,
      };
    }
    if (h.productionRunsClean < lower.cleanRunsRequired) {
      return {
        allow: false,
        reason:
          `rung ${lower.level} has ${h.productionRunsClean} clean runs, needs ` +
          `${lower.cleanRunsRequired}. The lower rungs are cheap and their value is the track record.`,
      };
    }
  }

  return { allow: true, rung };
}

/** An experiment with no abort condition is an outage you scheduled. */
export function validateExperiment(e: { hypothesis?: string; abortOn?: string }): void {
  if (!e.abortOn) {
    throw new Error('no abort condition: this is not an experiment, it is an outage you scheduled');
  }
  if (!e.hypothesis) {
    throw new Error('no hypothesis: without one there is no result, only an event');
  }
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Load shedding economics, with the manuscript's break-even corrected.
 *
 * The chapter claims "break-even: less than 2 days" against $2,400/month of avoided over-provisioning
 * and roughly 3 engineering days to build the shedder. Three engineering days is not free: at a
 * loaded rate it is several thousand dollars, so recovering it from $2,400 a month takes about a
 * month, not two days.
 *
 * The confusion is between two different denominators. Two days is roughly how long the SAVINGS take
 * to equal one day of the outage they prevent. Break-even against the BUILD COST is a different
 * number, and it is the one the phrase "break-even" means.
 */
export interface SheddingEconomics {
  monthlySavingsUsd: number;
  engineeringDays: number;
  loadedDailyRateUsd: number;
}

export interface SheddingVerdict {
  buildCostUsd: number;
  monthsToBreakEven: number;
  daysToBreakEven: number;
  firstYearNetUsd: number;
  /** Stated so the two-day figure and this one are never confused again. */
  note: string;
}

export function assessShedding(e: SheddingEconomics): SheddingVerdict {
  const buildCostUsd = e.engineeringDays * e.loadedDailyRateUsd;
  const monthsToBreakEven = buildCostUsd / e.monthlySavingsUsd;

  return {
    buildCostUsd,
    monthsToBreakEven,
    daysToBreakEven: monthsToBreakEven * 30,
    firstYearNetUsd: e.monthlySavingsUsd * 12 - buildCostUsd,
    note:
      'break-even is measured against the BUILD COST. A separate and much shorter figure is how ' +
      'long the savings take to equal one prevented outage; the two are not interchangeable.',
  };
}
