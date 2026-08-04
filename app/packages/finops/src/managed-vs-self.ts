/**
 * Managed versus self-hosted, and the horizon the manuscript's comparison leaves out.
 *
 * The chapter's numbers: the managed cache costs about $1,400/month more than the equivalent
 * open-source cache on raw instances, roughly $16,800/year. At $4,000/week loaded, the premium buys
 * about 4.2 engineering weeks per year. Self-hosting costs 3 to 4 weeks to build plus 1 to 1.5 weeks a
 * year of patching, failover testing and upgrades. The chapter concludes "the premium is cheaper than
 * the labor".
 *
 * In year one that is true, or close enough to be a coin flip: 4 to 5.5 weeks against 4.2.
 *
 * It stops being true immediately afterwards. The build cost does not recur, so from year two the
 * comparison is 1 to 1.5 weeks of upkeep against 4.2 weeks of premium, every year. Over three years
 * self-hosting is cheaper by roughly five engineering weeks.
 *
 * That does not overturn the recommendation. The chapter's OTHER stated reason is the real one: the
 * operational risk lands on the P0 path. Paying a premium to move failure modes off checkout is a
 * sound trade whether or not it also saves labor. The problem is only the sentence claiming the
 * premium is the cheaper option, since on any horizon a cache actually lives, it is not.
 *
 * So this module reports both, and refuses to collapse them into one number.
 */

export interface HostingComparison {
  premiumMonthlyUsd: number;
  loadedWeeklyRateUsd: number;
  buildWeeks: number;
  ongoingWeeksPerYear: number;
  /** True when the failure modes of self-hosting land on a P0 path. */
  operationalRiskOnP0Path: boolean;
}

export interface HorizonResult {
  years: number;
  premiumWeeks: number;
  selfHostWeeks: number;
  cheaperOnLabor: 'managed' | 'self-hosted' | 'too-close-to-call';
  premiumUsd: number;
  selfHostUsd: number;
}

/** Within this fraction, the labor comparison is not a decision. */
export const TOO_CLOSE_FRACTION = 0.15;

export function overHorizon(c: HostingComparison, years: number): HorizonResult {
  const premiumWeeks = ((c.premiumMonthlyUsd * 12) / c.loadedWeeklyRateUsd) * years;
  const selfHostWeeks = c.buildWeeks + c.ongoingWeeksPerYear * years;

  const spread = Math.abs(premiumWeeks - selfHostWeeks) / Math.max(premiumWeeks, selfHostWeeks);
  const cheaperOnLabor =
    spread <= TOO_CLOSE_FRACTION ? 'too-close-to-call' : premiumWeeks < selfHostWeeks ? 'managed' : 'self-hosted';

  return {
    years,
    premiumWeeks,
    selfHostWeeks,
    cheaperOnLabor,
    premiumUsd: premiumWeeks * c.loadedWeeklyRateUsd,
    selfHostUsd: selfHostWeeks * c.loadedWeeklyRateUsd,
  };
}

/** The year in which the recurring premium overtakes build-plus-upkeep. */
export function laborCrossoverYears(c: HostingComparison): number {
  const premiumPerYear = (c.premiumMonthlyUsd * 12) / c.loadedWeeklyRateUsd;
  const netPerYear = premiumPerYear - c.ongoingWeeksPerYear;
  if (netPerYear <= 0) return Number.POSITIVE_INFINITY; // upkeep alone costs more than the premium
  return c.buildWeeks / netPerYear;
}

export interface HostingRecommendation {
  choice: 'managed' | 'self-hosted';
  /** The reason that actually carries the decision. */
  basis: 'labor-cost' | 'operational-risk';
  laborSaysAtOneYear: HorizonResult['cheaperOnLabor'];
  laborSaysAtThreeYears: HorizonResult['cheaperOnLabor'];
  crossoverYears: number;
  reason: string;
}

/**
 * Recommend, and be explicit about which argument is doing the work.
 *
 * The Managed-By-Default Rule stands. The point of separating `basis` from the labor arithmetic is
 * that a decision resting on risk survives the arithmetic changing, and a decision resting on the
 * arithmetic does not.
 */
export function recommend(c: HostingComparison): HostingRecommendation {
  const oneYear = overHorizon(c, 1);
  const threeYear = overHorizon(c, 3);
  const crossoverYears = laborCrossoverYears(c);

  if (c.operationalRiskOnP0Path) {
    return {
      choice: 'managed',
      basis: 'operational-risk',
      laborSaysAtOneYear: oneYear.cheaperOnLabor,
      laborSaysAtThreeYears: threeYear.cheaperOnLabor,
      crossoverYears,
      reason:
        `the failure modes of self-hosting land on a P0 path, so the premium buys the removal of a ` +
        `class of incident rather than a block of hours. Note that on labor alone self-hosting becomes ` +
        `the cheaper option after about ${crossoverYears.toFixed(1)} years; the risk argument is what ` +
        `carries this decision, not the cost one.`,
    };
  }

  if (threeYear.cheaperOnLabor === 'self-hosted') {
    return {
      choice: 'self-hosted',
      basis: 'labor-cost',
      laborSaysAtOneYear: oneYear.cheaperOnLabor,
      laborSaysAtThreeYears: threeYear.cheaperOnLabor,
      crossoverYears,
      reason: `the build cost does not recur, so the premium overtakes build-plus-upkeep after about ${crossoverYears.toFixed(1)} years and keeps going.`,
    };
  }

  return {
    choice: 'managed',
    basis: 'labor-cost',
    laborSaysAtOneYear: oneYear.cheaperOnLabor,
    laborSaysAtThreeYears: threeYear.cheaperOnLabor,
    crossoverYears,
    reason: 'the premium is genuinely cheaper than the labor over the horizon considered.',
  };
}

export const SHOPFLOW_CACHE: HostingComparison = {
  premiumMonthlyUsd: 1_400,
  loadedWeeklyRateUsd: 4_000,
  buildWeeks: 3.5, // the chapter's 3 to 4
  ongoingWeeksPerYear: 1.25, // the chapter's 1 to 1.5
  operationalRiskOnP0Path: true,
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The Reversible Default Rule: managed versus self-hosted is a decision with a review date, not a
 * permanent architectural position. The inputs that move it are the premium, the loaded rate, and the
 * scale at which the premium is charged.
 */
export interface ReviewableDecision {
  service: string;
  decidedOnMonthlyPremiumUsd: number;
  currentMonthlyPremiumUsd: number;
  monthsSinceDecision: number;
  reviewIntervalMonths: number;
}

export type ReviewVerdict = { revisit: false } | { revisit: true; reason: string };

export function shouldRevisit(d: ReviewableDecision): ReviewVerdict {
  if (d.monthsSinceDecision >= d.reviewIntervalMonths) {
    return { revisit: true, reason: `${d.monthsSinceDecision} months since the decision, review interval is ${d.reviewIntervalMonths}` };
  }
  const growth = (d.currentMonthlyPremiumUsd - d.decidedOnMonthlyPremiumUsd) / d.decidedOnMonthlyPremiumUsd;
  if (growth >= 0.5) {
    return {
      revisit: true,
      reason:
        `the premium has grown ${(growth * 100).toFixed(0)}% since the decision was made. The decision ` +
        `was correct for a premium that no longer exists.`,
    };
  }
  return { revisit: false };
}
