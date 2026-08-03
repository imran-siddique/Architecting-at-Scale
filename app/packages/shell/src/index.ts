export { Shell, type Criticality, type MicroApp, type RenderReport } from './error-boundary.js';
export { EventBus, assertDataOnly, type BusOptions, type EventPayload } from './event-bus.js';
export { StateRegistry, type Owned } from './state-ownership.js';
export {
  checkBudgets,
  type AppBudget,
  type AppMeasurement,
  type BudgetFinding,
  type BudgetReport,
  type CheckOptions,
} from './budget.js';
