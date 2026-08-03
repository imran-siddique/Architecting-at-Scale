/**
 * Per-micro-app performance budgets, with attribution.
 *
 * Chapter 5's telemetry: a 5.2MB gzipped bundle and 2.8s of main-thread blocking. Dave's
 * complaint is not the size, it is that "I can't even tell you which team's code caused the
 * regression. It's all one giant bundle."
 *
 * Attribution is therefore the feature, not the totals. A budget that reports only a fleet-wide
 * number tells you that you have a problem without telling you who can fix it, which is how a
 * performance budget becomes a standing agenda item nobody owns.
 *
 * The Budget Visibility Rule from the chapter: track budgets on dashboards with a weekly review
 * cadence, and reserve hard CI gates for critical thresholds only. `checkBudgets` reflects that
 * by separating `over` (report it) from `breaching` (fail the build).
 */

export interface AppBudget {
  name: string;
  team: string;
  /** Gzipped JavaScript budget in kilobytes. */
  jsBudgetKb: number;
  /** Main-thread blocking budget in milliseconds. */
  blockingBudgetMs: number;
}

export interface AppMeasurement {
  name: string;
  jsKb: number;
  blockingMs: number;
}

export interface BudgetFinding {
  name: string;
  team: string;
  metric: 'jsKb' | 'blockingMs';
  budget: number;
  actual: number;
  /** actual divided by budget. 2.0 is a doubling. */
  ratio: number;
}

export interface BudgetReport {
  totalJsKb: number;
  totalBlockingMs: number;
  /** Over budget: report on the dashboard, review weekly. */
  over: BudgetFinding[];
  /** Past the hard gate: fail the build. */
  breaching: BudgetFinding[];
  /** Teams named by at least one finding. This is what Dave could not produce. */
  teamsResponsible: string[];
}

export interface CheckOptions {
  /**
   * The hard-gate multiple. The chapter's example of a threshold worth blocking on is a bundle
   * size doubling, so the default is 2.
   */
  hardGateRatio?: number;
}

export function checkBudgets(
  budgets: AppBudget[],
  measurements: AppMeasurement[],
  opts: CheckOptions = {},
): BudgetReport {
  const hardGate = opts.hardGateRatio ?? 2;
  const byName = new Map(budgets.map((b) => [b.name, b]));
  const over: BudgetFinding[] = [];
  const breaching: BudgetFinding[] = [];
  let totalJsKb = 0;
  let totalBlockingMs = 0;

  for (const m of measurements) {
    const b = byName.get(m.name);
    if (!b) throw new Error(`measurement for unregistered micro-app "${m.name}"`);
    totalJsKb += m.jsKb;
    totalBlockingMs += m.blockingMs;

    const checks: Array<[BudgetFinding['metric'], number, number]> = [
      ['jsKb', b.jsBudgetKb, m.jsKb],
      ['blockingMs', b.blockingBudgetMs, m.blockingMs],
    ];
    for (const [metric, budget, actual] of checks) {
      if (actual > budget) {
        const finding: BudgetFinding = {
          name: m.name,
          team: b.team,
          metric,
          budget,
          actual,
          ratio: actual / budget,
        };
        over.push(finding);
        if (finding.ratio >= hardGate) breaching.push(finding);
      }
    }
  }

  return {
    totalJsKb,
    totalBlockingMs,
    over,
    breaching,
    teamsResponsible: [...new Set(over.map((f) => f.team))],
  };
}
