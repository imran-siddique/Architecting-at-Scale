/**
 * The Strangler Fig, with the Time-Box Mandate enforced.
 *
 * Chapter 6's Three-Wave Rule stages a migration: route, then extract, then retire. The Time-Box
 * Mandate is the part that decides whether it finishes: set the Wave 3 completion date before
 * Wave 1 begins, publish it, and treat it as a constraint rather than a target. "A migration
 * without a completion constraint does not complete; it becomes a permanent operational state."
 *
 * So the router refuses to exist without a deadline, and reports when it has outlived it. That is
 * the Permanent Proxy anti-pattern: routing infrastructure that survives its migration and starts
 * accumulating logic of its own, at which point you have added a distributed system and removed
 * nothing.
 */

export type Wave = 1 | 2 | 3;
export type Target = 'monolith' | 'service';

export interface RouteRule {
  /** Path prefix this rule governs, for example /api/orders. */
  prefix: string;
  /** The extracted service that should eventually own it. */
  service: string;
  /** Share of traffic sent to the service, 0..1. */
  weight: number;
  wave: Wave;
}

export interface StranglerOptions {
  /**
   * Wave 3 completion date, as epoch ms. Required: the mandate is that this is set before Wave 1
   * begins, so a router that cannot state its deadline has already failed the rule.
   */
  completeBy: number;
  rules: RouteRule[];
  now?: () => number;
}

export interface RoutingDecision {
  target: Target;
  service?: string;
  matched?: string;
}

export interface StranglerStatus {
  /** True once every rule routes 100% to its service and is in Wave 3. */
  migrationComplete: boolean;
  /** Rules still sending any traffic to the monolith. */
  outstanding: string[];
  /** Past the published date with work outstanding. The Permanent Proxy warning. */
  overdue: boolean;
  daysRemaining: number;
}

export class StranglerRouter {
  private readonly rules: RouteRule[];
  private readonly completeBy: number;
  private readonly now: () => number;

  constructor(opts: StranglerOptions) {
    if (!Number.isFinite(opts.completeBy)) {
      throw new Error(
        'a Strangler Fig router requires a Wave 3 completion date: a migration without a completion constraint becomes a permanent operational state',
      );
    }
    for (const r of opts.rules) {
      if (r.weight < 0 || r.weight > 1) {
        throw new RangeError(`weight for ${r.prefix} must be between 0 and 1, got ${r.weight}`);
      }
      if (!r.prefix.startsWith('/')) {
        throw new Error(`route prefix must be absolute: ${r.prefix}`);
      }
    }
    // Longest prefix first, so /api/orders/returns is not swallowed by /api/orders.
    this.rules = [...opts.rules].sort((a, b) => b.prefix.length - a.prefix.length);
    this.completeBy = opts.completeBy;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Route one request. `roll` is the caller's random draw, injected so routing is deterministic
   * under test. A stable hash of the user id is the better production choice, so a given customer
   * does not flip between implementations mid-session.
   */
  route(path: string, roll: number): RoutingDecision {
    const rule = this.rules.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
    if (!rule) return { target: 'monolith' };
    return roll < rule.weight
      ? { target: 'service', service: rule.service, matched: rule.prefix }
      : { target: 'monolith', matched: rule.prefix };
  }

  status(): StranglerStatus {
    const outstanding = this.rules.filter((r) => r.weight < 1 || r.wave < 3).map((r) => r.prefix);
    const msRemaining = this.completeBy - this.now();
    return {
      migrationComplete: outstanding.length === 0,
      outstanding,
      overdue: outstanding.length > 0 && msRemaining < 0,
      daysRemaining: Math.floor(msRemaining / 86_400_000),
    };
  }

  /**
   * The Permanent Proxy check, for CI.
   *
   * Fails when the published date has passed with routes still outstanding. The value is that it
   * fails on a date rather than on someone noticing, because nobody ever notices: the proxy works,
   * so there is never a day when leaving it becomes visibly wrong.
   */
  assertNotPermanent(): void {
    const s = this.status();
    if (s.overdue) {
      throw new Error(
        `Strangler Fig migration is ${-s.daysRemaining} days past its published completion date ` +
          `with routes outstanding: ${s.outstanding.join(', ')}. ` +
          `Either finish it or re-plan it, but do not let the proxy become the architecture.`,
      );
    }
  }
}
