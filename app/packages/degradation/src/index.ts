export {
  CORRECTNESS_FLOOR,
  SHOPFLOW_CAPABILITIES,
  coverageReport,
  grade,
  isCorrectnessFloor,
  type Capability,
  type FloorCapability,
  type Grade,
  type Priority,
} from './classification.js';
export {
  applyFairShare,
  attemptCheckout,
  type CheckoutResult,
  type Consumer,
  type DegradedContext,
  type FairShareResult,
  type StepRecord,
} from './degraded-checkout.js';
export {
  CHAOS_RUNGS,
  assessShedding,
  mayRunAt,
  validateExperiment,
  type ProgressionVerdict,
  type Rung as ChaosRung,
  type RungHistory,
  type SheddingEconomics,
  type SheddingVerdict,
} from './chaos.js';
