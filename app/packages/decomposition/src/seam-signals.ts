/**
 * The Gravity Signal Rule, as a scoring function.
 *
 * Chapter 6's wording: extract a service when three or more of the following are true. Build time
 * dominated by the module, test blast radius beyond its domain, deployment success rate below the
 * organizational SLO, read/write scaling requirements diverging from neighbours, or merge conflict
 * density indicating sustained boundary violation. "A single signal is a data point. Three signals
 * are a mandate."
 *
 * That is a threshold, not a feeling, which is exactly the kind of thing that should be computed
 * rather than argued about in a meeting. The companion No-Signal Rule is the more useful half and
 * the one teams skip: a module with no active seam signal is not a service waiting to be born, it
 * is a module doing its job.
 */

export const SIGNALS = [
  'buildTimeDominated',
  'testBlastRadiusEscapes',
  'deploySuccessBelowSlo',
  'scalingDivergesFromNeighbours',
  'mergeConflictDensity',
] as const;

export type SignalName = (typeof SIGNALS)[number];

/** Raw measurements for one module of the monolith. */
export interface ModuleMetrics {
  name: string;
  /** Share of total build time attributable to this module, 0..1. */
  buildTimeShare: number;
  /** Modules outside this one whose tests must run when it changes. */
  testBlastRadiusModules: number;
  /** Deployment success rate for changes touching this module, 0..1. */
  deploySuccessRate: number;
  /** Reads per write. Diverges materially when it is far from its neighbours. */
  readWriteRatio: number;
  /** Merge conflicts per sprint involving this module. */
  mergeConflictsPerSprint: number;
  /** Teams contributing to it. Used for context, not scored directly. */
  contributingTeams: number;
}

export interface Thresholds {
  /** A module dominating the build. ShopFlow's build is 47 minutes. */
  buildTimeShare: number;
  testBlastRadiusModules: number;
  /** The organizational SLO. ShopFlow's backend deploy success rate is 65%. */
  deploySuccessSlo: number;
  /** How far a read/write ratio must be from the fleet median to count as divergent. */
  scalingDivergenceFactor: number;
  mergeConflictsPerSprint: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  buildTimeShare: 0.2,
  testBlastRadiusModules: 3,
  deploySuccessSlo: 0.95,
  scalingDivergenceFactor: 5,
  mergeConflictsPerSprint: 3,
};

export interface Assessment {
  name: string;
  active: SignalName[];
  /** Three or more active signals is the mandate. */
  extract: boolean;
  /**
   * A pain score used only to ORDER extractions, never to decide whether to extract.
   * The decision is the signal count; the score breaks ties between modules that qualify.
   */
  painScore: number;
}

/**
 * Assess one module against its neighbours.
 *
 * `neighbourRatios` supplies the read/write ratios of the other modules, because "diverges
 * materially from neighbours" is a comparison and cannot be evaluated for a module in isolation.
 */
export function assessModule(
  m: ModuleMetrics,
  neighbourRatios: number[],
  t: Thresholds = DEFAULT_THRESHOLDS,
): Assessment {
  const active: SignalName[] = [];

  if (m.buildTimeShare >= t.buildTimeShare) active.push('buildTimeDominated');
  if (m.testBlastRadiusModules >= t.testBlastRadiusModules) active.push('testBlastRadiusEscapes');
  if (m.deploySuccessRate < t.deploySuccessSlo) active.push('deploySuccessBelowSlo');

  if (neighbourRatios.length > 0) {
    const median = [...neighbourRatios].sort((a, b) => a - b)[Math.floor(neighbourRatios.length / 2)]!;
    const factor = median === 0 ? Infinity : Math.max(m.readWriteRatio / median, median / m.readWriteRatio);
    if (factor >= t.scalingDivergenceFactor) active.push('scalingDivergesFromNeighbours');
  }

  if (m.mergeConflictsPerSprint >= t.mergeConflictsPerSprint) active.push('mergeConflictDensity');

  // Normalized so no single dimension dominates the ordering. Deliberately separate from the
  // extract decision: the chapter is explicit that three signals are the mandate, and a very
  // painful module with two signals is still a module doing its job.
  const painScore =
    m.buildTimeShare * 100 +
    m.testBlastRadiusModules * 5 +
    (1 - m.deploySuccessRate) * 100 +
    m.mergeConflictsPerSprint * 3;

  return { name: m.name, active, extract: active.length >= 3, painScore };
}

export interface DecompositionPlan {
  /** Modules that qualify, in the order they should be extracted. */
  sequence: Assessment[];
  /** Modules that do not qualify. Per the No-Signal Rule, these stay. */
  stay: Assessment[];
  /**
   * The Service Count Rule: the minimum number of services required to eliminate the observable
   * seam signals. Every service beyond this is a liability you must be able to name a benefit for.
   */
  minimumServiceCount: number;
}

/**
 * Build the extraction plan.
 *
 * The Extraction Sequence Doctrine: extract in descending order of pain, starting with the module
 * generating the most observable harm. Never leave the highest-pain module for last. The ordering
 * is therefore the point of this function, not a presentational detail.
 */
export function planDecomposition(
  modules: ModuleMetrics[],
  t: Thresholds = DEFAULT_THRESHOLDS,
): DecompositionPlan {
  const assessed = modules.map((m) =>
    assessModule(m, modules.filter((o) => o.name !== m.name).map((o) => o.readWriteRatio), t),
  );

  const sequence = assessed
    .filter((a) => a.extract)
    .sort((a, b) => b.painScore - a.painScore || a.name.localeCompare(b.name));

  return {
    sequence,
    stay: assessed.filter((a) => !a.extract).sort((a, b) => a.name.localeCompare(b.name)),
    // The monolith itself remains a service for as long as anything is left in it.
    minimumServiceCount: sequence.length + (assessed.some((a) => !a.extract) ? 1 : 0),
  };
}

/**
 * Anti-Pattern: The Verb Boundary.
 *
 * Decomposing by HTTP method produces a Create Service, a Read Service, an Update Service. It is
 * architecturally coherent and domain-incoherent: an Order's create, read and update share
 * business rules, validation and state transitions, so separating them by verb makes every rule
 * change touch four services instead of one. One deployment dependency traded for four.
 *
 * Cheap to detect and worth failing a design review over.
 */
const VERBS = ['create', 'read', 'write', 'update', 'delete', 'get', 'put', 'post', 'patch', 'query', 'command'];

export function detectVerbBoundaries(serviceNames: string[]): string[] {
  return serviceNames.filter((name) => {
    const words = name.toLowerCase().split(/[\s\-_]+/);
    return words.some((w) => VERBS.includes(w));
  });
}
