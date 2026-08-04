/**
 * Unit economics, and the one unit metric that improves while the product gets worse.
 *
 * ShopFlow enters Chapter 14 right-sized and ungoverned: spend is traceable to a service but not to a
 * unit of business value. The fix is a denominator, and the chapter is careful about which one.
 *
 * The Unit-Economics Rule: total spend rising is not a problem if cost per unit is flat, because the
 * business is simply larger. Cost per unit rising is always a problem even when total spend looks calm.
 *
 * The Successful-Unit Rule is the sharper one: divide by SUCCESSFUL units, never attempted ones. A
 * denominator that counts abandoned carts and failed conversations rewards a system for failing
 * cheaply.
 */

export interface Period {
  label: string;
  totalSpendUsd: number;
  attemptedUnits: number;
  successfulUnits: number;
}

export interface UnitCost {
  label: string;
  costPerSuccessfulUnitUsd: number;
  costPerAttemptedUnitUsd: number;
  successRate: number;
}

export function unitCost(p: Period): UnitCost {
  return {
    label: p.label,
    costPerSuccessfulUnitUsd: p.totalSpendUsd / p.successfulUnits,
    costPerAttemptedUnitUsd: p.totalSpendUsd / p.attemptedUnits,
    successRate: p.successfulUnits / p.attemptedUnits,
  };
}

export type Signal =
  | { verdict: 'healthy'; note: string }
  | { verdict: 'unit-cost-rising'; unitCostChange: number; note: string }
  | { verdict: 'larger-business'; note: string };

/**
 * Compare two periods the way the rule says to: on the slope of the unit cost, not the absolute bill.
 */
export function assessTrend(before: Period, after: Period): Signal {
  const b = unitCost(before);
  const a = unitCost(after);
  const unitCostChange = (a.costPerSuccessfulUnitUsd - b.costPerSuccessfulUnitUsd) / b.costPerSuccessfulUnitUsd;
  const spendGrew = after.totalSpendUsd > before.totalSpendUsd;

  if (unitCostChange > 0.05) {
    return {
      verdict: 'unit-cost-rising',
      unitCostChange,
      note:
        `cost per unit rose ${(unitCostChange * 100).toFixed(1)}%. This is always a problem, because ` +
        `each unit of value is getting more expensive to deliver.`,
    };
  }
  if (spendGrew) {
    return {
      verdict: 'larger-business',
      note: 'total spend rose and cost per unit did not. The business is simply larger.',
    };
  }
  return { verdict: 'healthy', note: 'spend flat or falling, unit cost flat or falling' };
}

/**
 * The Trend-Not-Absolute Rule, and why a round-number ceiling misses the thing it was set for.
 *
 * ShopFlow's LLM bill grew 90% over two months, which added about $900 to an $8,635 bill. No spend
 * ceiling was set at $9,535, so nothing fired. Cost per order went from $0.091 to $0.100, a 10% rise
 * against flat order growth, and that slope was the signal.
 */
export function ceilingWouldCatch(input: {
  beforeSpendUsd: number;
  afterSpendUsd: number;
  ceilingUsd: number;
}): boolean {
  return input.afterSpendUsd >= input.ceilingUsd && input.beforeSpendUsd < input.ceilingUsd;
}

export const SHOPFLOW_BEFORE_AI: Period = {
  label: 'before the recommendation feature',
  totalSpendUsd: 8_635,
  attemptedUnits: 118_750, // carts started
  successfulUnits: 95_000, // orders placed
};

export const SHOPFLOW_AFTER_AI: Period = {
  label: 'after the recommendation feature',
  totalSpendUsd: 9_535,
  attemptedUnits: 118_750,
  successfulUnits: 95_000, // flat order growth, which is what makes the slope legible
};

/* ------------------------------------------------------------------------------------------- */

/**
 * The Line-Item Ownership Rule: every line item maps to a team that owns it. Spend with no owner is
 * spend nobody reduces.
 *
 * The tagging exercise is worth modelling because of what it actually produced. Tagging did not cut
 * the bill; it converted an unexaminable 23% into attributable spend, and the act of chasing owners
 * surfaced the recoverable waste that had been hiding inside it.
 */
export interface LineItem {
  name: string;
  monthlyUsd: number;
  owner: string | null;
  tags: { service?: string; environment?: string; team?: string };
}

export const MANDATORY_TAGS = ['service', 'environment', 'team'] as const;

export interface AttributionReport {
  totalUsd: number;
  untaggedUsd: number;
  untaggedFraction: number;
  unownedUsd: number;
  missingTagsByItem: Record<string, string[]>;
}

export function attribute(items: LineItem[]): AttributionReport {
  const totalUsd = items.reduce((a, i) => a + i.monthlyUsd, 0);
  const missingTagsByItem: Record<string, string[]> = {};
  let untaggedUsd = 0;
  let unownedUsd = 0;

  for (const item of items) {
    const missing = MANDATORY_TAGS.filter((t) => !item.tags[t]);
    if (missing.length > 0) {
      missingTagsByItem[item.name] = [...missing];
      untaggedUsd += item.monthlyUsd;
    }
    if (item.owner === null) unownedUsd += item.monthlyUsd;
  }

  return {
    totalUsd,
    untaggedUsd,
    untaggedFraction: totalUsd === 0 ? 0 : untaggedUsd / totalUsd,
    unownedUsd,
    missingTagsByItem,
  };
}

/**
 * What the tagging exercise recovers is not the untagged spend. It is the waste the exercise exposes.
 * Conflating the two overstates the return by a factor of three or four.
 */
export function tagggingReturn(input: {
  untaggedMonthlyUsd: number;
  wasteFoundMonthlyUsd: number;
}): { reclassifiedMonthlyUsd: number; recoveredMonthlyUsd: number; recoveredAnnualUsd: number; note: string } {
  return {
    reclassifiedMonthlyUsd: input.untaggedMonthlyUsd,
    recoveredMonthlyUsd: input.wasteFoundMonthlyUsd,
    recoveredAnnualUsd: input.wasteFoundMonthlyUsd * 12,
    note:
      'tagging does not cut the bill. It converts unexaminable spend into attributable spend, and the ' +
      'saving is whatever the examination then finds.',
  };
}
