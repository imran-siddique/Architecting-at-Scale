/**
 * Correlation ID propagation across a real checkout, and where it breaks.
 *
 * ShopFlow's silent failure lives at hop 6, and the reason it was invisible is the whole point of
 * this file. The trace was propagated by HTTP header, which works for every synchronous hop and
 * fails silently at the async one, because brokers, bridges and dead-letter requeues do not
 * preserve headers they were never asked to carry.
 *
 * So the failed orders had traces that simply stopped at the broker, and a trace that stops looks
 * exactly like a request that finished.
 *
 * The rule: on a synchronous hop the ID rides the header. On an asynchronous hop it must be in the
 * PAYLOAD. Chapter 2 introduced the correlation ID; this is the boundary where the naive version
 * of it stops working.
 */

export type HopKind = 'sync' | 'async' | 'external';

export interface Hop {
  index: number;
  from: string;
  to: string;
  kind: HopKind;
}

/** ShopFlow's checkout, seven hops. Hop 6 is the async one that lost the trace. */
export const CHECKOUT_HOPS: Hop[] = [
  { index: 1, from: 'browser', to: 'api-gateway', kind: 'sync' },
  { index: 2, from: 'api-gateway', to: 'bff', kind: 'sync' },
  { index: 3, from: 'bff', to: 'orders', kind: 'sync' },
  { index: 4, from: 'orders', to: 'inventory', kind: 'sync' },
  { index: 5, from: 'orders', to: 'payments', kind: 'sync' },
  // The boundary. An event goes onto the broker and a consumer picks it up later.
  { index: 6, from: 'orders', to: 'fulfilment-consumer', kind: 'async' },
  { index: 7, from: 'fulfilment-consumer', to: 'carrier-api', kind: 'external' },
];

export type Carrier = 'header-only' | 'header-and-payload';

export interface Envelope {
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

/** What a broker does to a message it was not told to preserve headers for. */
export function crossBroker(envelope: Envelope): Envelope {
  // Headers are stripped. This is not a bug in the broker, it is the default for most of them,
  // and for bridges and dead-letter requeues it is close to universal.
  return { headers: {}, payload: { ...envelope.payload } };
}

/** An external system that returns its own response, carrying nothing of ours. */
export function crossExternal(envelope: Envelope): Envelope {
  return { headers: {}, payload: {} };
}

export interface PropagationResult {
  /** Hops where the correlation ID was still present on arrival. */
  reachedHops: number[];
  /** The hop at which the trace went dark, or null if it survived. */
  lostAtHop: number | null;
  /** External hops need a registry entry to bridge them; recorded here. */
  bridgedHops: number[];
}

/**
 * Walk the hops and report where the ID survives.
 *
 * `registry` models the ID registry that bridges an external call: you record your correlation ID
 * against the carrier's own reference before the call, so the two can be joined afterwards. Without
 * it, an external hop is a permanent break rather than a stripped header.
 */
export function propagate(
  hops: Hop[],
  correlationId: string,
  carrier: Carrier,
  registry?: Map<string, string>,
): PropagationResult {
  let env: Envelope = {
    headers: { 'x-correlation-id': correlationId },
    payload: carrier === 'header-and-payload' ? { correlationId } : {},
  };

  const reached: number[] = [];
  const bridged: number[] = [];
  let lostAt: number | null = null;

  for (const hop of hops) {
    if (hop.kind === 'sync') {
      // Nothing is stripped, so a header is sufficient here. This is why the naive version passes
      // every test that only exercises synchronous calls.
      env = { headers: { ...env.headers }, payload: { ...env.payload } };
    } else if (hop.kind === 'async') {
      env = crossBroker(env);
      // Recover from the payload if it was put there.
      const fromPayload = env.payload['correlationId'];
      if (typeof fromPayload === 'string') {
        env = { headers: { 'x-correlation-id': fromPayload }, payload: env.payload };
      }
    } else {
      // External. The registry is the only way across.
      const before = env.headers['x-correlation-id'];
      env = crossExternal(env);
      if (before && registry) {
        registry.set(`carrier-ref-${hop.index}`, before);
        bridged.push(hop.index);
        env = { headers: { 'x-correlation-id': before }, payload: { correlationId: before } };
      }
    }

    if (env.headers['x-correlation-id'] === correlationId) {
      reached.push(hop.index);
    } else if (lostAt === null) {
      lostAt = hop.index;
    }
  }

  return { reachedHops: reached, lostAtHop: lostAt, bridgedHops: bridged };
}

/**
 * A trace that stops is indistinguishable from a request that finished.
 *
 * This is why the 0.3% was invisible for so long: nothing alerted, because from the tracing
 * backend's point of view those journeys ended normally at hop 5.
 */
export function looksComplete(result: PropagationResult, totalHops: number): boolean {
  return result.lostAtHop !== null && result.reachedHops.length < totalHops;
}
