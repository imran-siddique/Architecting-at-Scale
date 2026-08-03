export {
  DEFAULT_THRESHOLDS,
  SIGNALS,
  assessModule,
  detectVerbBoundaries,
  planDecomposition,
  type Assessment,
  type DecompositionPlan,
  type ModuleMetrics,
  type SignalName,
  type Thresholds,
} from './seam-signals.js';
export {
  StranglerRouter,
  type RouteRule,
  type RoutingDecision,
  type StranglerOptions,
  type StranglerStatus,
  type Target,
  type Wave,
} from './strangler.js';
export {
  checkCompatibility,
  type Break,
  type BreakKind,
  type CompatResult,
  type Contract,
  type ConsumerTolerance,
  type FieldSpec,
  type FieldType,
} from './contract-compat.js';
