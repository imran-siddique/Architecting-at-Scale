/**
 * The Graduated Response Rule.
 *
 * Chapter 7 gives exact thresholds, which is unusual and welcome: "Before a circuit opens, it
 * should slow down. At 10% error rate, reduce traffic to the degraded service by 25%. At 25% error
 * rate, reduce by 50%. At 50% error rate, open the circuit."
 *
 * The reason it is graduated rather than binary is the Trigger-Happy Circuit Breaker anti-pattern,
 * which is a genuine feedback loop and worth spelling out because it looks like the breaker
 * working:
 *
 *   1. Thresholds are low, so the breaker opens on a transient blip.
 *   2. Traffic is cut, so the downstream service receives less load.
 *   3. Less load makes it look healthier, so the half-open probe succeeds.
 *   4. The circuit closes, full traffic returns, and the service degrades again.
 *
 * That oscillation is worse than either state, because consumers now see intermittent failure
 * with no pattern. `flapCount` exists to detect it.
 */

export type CircuitState = 'closed' | 'throttled-25' | 'throttled-50' | 'open' | 'half-open';

export interface BreakerThresholds {
  /** Error rate at which to shed 25% of traffic. */
  throttle25At: number;
  /** Error rate at which to shed 50%. */
  throttle50At: number;
  /** Error rate at which to open. */
  openAt: number;
  /** How long the circuit stays open before probing. */
  openMs: number;
  /** Minimum observations before any state change. Below this, error rate is noise. */
  minimumSamples: number;
  /** Consecutive successful probes required to fully close. More than one, deliberately. */
  probesToClose: number;
}

export const CHAPTER7_THRESHOLDS: BreakerThresholds = {
  throttle25At: 0.10,
  throttle50At: 0.25,
  openAt: 0.50,
  openMs: 30_000,
  // Not in the chapter's numbers, but required to avoid the anti-pattern the chapter names:
  // a threshold evaluated on three requests will open on a single blip.
  minimumSamples: 20,
  probesToClose: 3,
};

export interface BreakerSnapshot {
  state: CircuitState;
  errorRate: number;
  samples: number;
  /** Share of traffic currently admitted, 0..1. */
  admitFraction: number;
  /** Open-to-closed transitions. A rising count is the Trigger-Happy signature. */
  flapCount: number;
}

export class CircuitBreaker {
  private successes = 0;
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  private consecutiveProbeSuccesses = 0;
  private flaps = 0;

  constructor(
    private readonly t: BreakerThresholds = CHAPTER7_THRESHOLDS,
    private readonly now: () => number = Date.now,
  ) {}

  private get samples(): number {
    return this.successes + this.failures;
  }

  private get errorRate(): number {
    return this.samples === 0 ? 0 : this.failures / this.samples;
  }

  /** Traffic admitted in the current state. This is the graduated part. */
  private admitFractionFor(state: CircuitState): number {
    switch (state) {
      case 'closed': return 1;
      case 'throttled-25': return 0.75;
      case 'throttled-50': return 0.5;
      case 'half-open': return 0.1;
      case 'open': return 0;
    }
  }

  /**
   * Should this request be attempted? `roll` is the caller's random draw, injected so the
   * graduated states are deterministic under test.
   */
  shouldAttempt(roll: number): boolean {
    if (this.state === 'open' && this.now() - this.openedAt >= this.t.openMs) {
      this.state = 'half-open';
      this.consecutiveProbeSuccesses = 0;
    }
    return roll < this.admitFractionFor(this.state);
  }

  record(outcome: 'success' | 'failure'): void {
    if (outcome === 'success') this.successes++;
    else this.failures++;

    if (this.state === 'half-open') {
      if (outcome === 'failure') {
        this.trip();
        return;
      }
      this.consecutiveProbeSuccesses++;
      // Requiring several consecutive successes is the direct counter to step 3 of the
      // anti-pattern: one probe against a service receiving 10% of its load proves nothing.
      if (this.consecutiveProbeSuccesses >= this.t.probesToClose) {
        this.state = 'closed';
        this.flaps++;
        this.reset();
      }
      return;
    }

    if (this.samples < this.t.minimumSamples) return;

    const rate = this.errorRate;
    if (rate >= this.t.openAt) this.trip();
    else if (rate >= this.t.throttle50At) this.state = 'throttled-50';
    else if (rate >= this.t.throttle25At) this.state = 'throttled-25';
    else this.state = 'closed';
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = this.now();
    this.consecutiveProbeSuccesses = 0;
  }

  private reset(): void {
    this.successes = 0;
    this.failures = 0;
  }

  snapshot(): BreakerSnapshot {
    return {
      state: this.state,
      errorRate: this.errorRate,
      samples: this.samples,
      admitFraction: this.admitFractionFor(this.state),
      flapCount: this.flaps,
    };
  }

  /**
   * The Trigger-Happy check for an alert or a test.
   *
   * Repeated open-to-closed cycles in a short window mean the thresholds are too tight for the
   * traffic. The failure looks like the breaker working, which is why it needs naming.
   */
  isFlapping(threshold = 3): boolean {
    return this.flaps >= threshold;
  }
}
