/**
 * The Event Bus, with the Golden Rule enforced rather than documented.
 *
 * Chapter 5's Golden Rule: state flows down within a micro-app, events flow sideways between
 * micro-apps, and nothing flows globally. The critical constraint is that events carry DATA, not
 * BEHAVIOUR. A micro-app publishes a fact ("item added to cart, new count 3"). It never publishes
 * an instruction ("re-render your cart badge"). The consumer decides how and whether to react.
 *
 * The note in ch5/Event Bus.md describes this. What is added here is enforcement: a payload
 * containing a function is rejected at publish time, because once one team ships a callback
 * through the bus, the bus has become a coupling mechanism and the isolation is gone. That
 * degradation is gradual, and nobody notices the first instance.
 */

export type EventPayload = Record<string, unknown>;

const PREFIX = 'shopflow:';

/** A payload must be serializable. Functions, symbols and cycles are all coupling in disguise. */
export function assertDataOnly(payload: EventPayload, path = 'payload'): void {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, where: string): void => {
    if (typeof value === 'function') {
      throw new TypeError(
        `${where} is a function: events carry data, not behaviour. Publish the fact and let the consumer decide how to react.`,
      );
    }
    if (typeof value === 'symbol') {
      throw new TypeError(`${where} is a symbol, which will not survive serialization`);
    }
    if (value && typeof value === 'object') {
      if (seen.has(value as object)) {
        throw new TypeError(`${where} contains a cycle and cannot be serialized`);
      }
      seen.add(value as object);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, `${where}.${k}`);
      }
    }
  };
  walk(payload, path);
}

export interface BusOptions {
  /** Injected so the bus is testable outside a browser. Defaults to a standalone EventTarget. */
  target?: EventTarget;
  /** Where a consumer's last-known value is kept, for the degraded path. */
  storage?: Map<string, string>;
  now?: () => number;
}

export class EventBus {
  private readonly target: EventTarget;
  private readonly storage: Map<string, string>;
  private readonly now: () => number;

  constructor(opts: BusOptions = {}) {
    this.target = opts.target ?? new EventTarget();
    this.storage = opts.storage ?? new Map();
    this.now = opts.now ?? Date.now;
  }

  /** Publish a fact. Frozen, timestamped, and verified to contain no behaviour. */
  publish(eventName: string, payload: EventPayload): void {
    assertDataOnly(payload);
    const detail = Object.freeze({ ...payload, _timestamp: this.now() });
    this.target.dispatchEvent(new CustomEvent(`${PREFIX}${eventName}`, { detail }));
    // Remember the last known value so a consumer that loads later, or whose publisher has
    // crashed, still has something to show. This is the State Ownership Rule in practice: the
    // owning micro-app holds the authoritative value and consumers keep a degraded fallback.
    this.storage.set(`${PREFIX}${eventName}:last`, JSON.stringify(detail));
  }

  /** Subscribe. Returns an unsubscribe function, because a leaked listener is a memory leak. */
  subscribe(eventName: string, handler: (payload: EventPayload) => void): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent).detail as EventPayload);
    };
    this.target.addEventListener(`${PREFIX}${eventName}`, listener);
    return () => this.target.removeEventListener(`${PREFIX}${eventName}`, listener);
  }

  /**
   * The last published value, or null if nothing has been published.
   *
   * This is what a consumer initializes from, rather than from a global store. If the publishing
   * micro-app has not loaded yet, or has crashed, the consumer still renders its last known
   * state instead of a blank region.
   */
  lastKnown(eventName: string): EventPayload | null {
    const raw = this.storage.get(`${PREFIX}${eventName}:last`);
    return raw === undefined ? null : (JSON.parse(raw) as EventPayload);
  }
}
