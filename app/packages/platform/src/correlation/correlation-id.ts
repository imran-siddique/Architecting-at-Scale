import { randomUUID } from 'node:crypto';

/**
 * The Correlation ID.
 *
 * Chapter 2 calls this the one non-negotiable requirement of any distributed system: without it,
 * a failure in service D cannot be traced back to the request in service A, and you are guessing.
 * ShopFlow is still a monolith at this point, which is exactly why it goes in now — retrofitting
 * it after decomposition means retrofitting it across six services at once.
 *
 * The rule from the chapter is "generate at the edge, trust but verify":
 *
 *   - absent    -> the edge mints one
 *   - valid     -> preserved, so a client can trace end to end through its own systems
 *   - malformed -> REGENERATED, never passed through
 *
 * The third case is the one that gets skipped, and it is the one that matters. An ID taken from
 * an untrusted client and written straight into your logs is a log-injection vector and a
 * cardinality bomb: a caller sending a fresh 4KB value per request can blow up an index or
 * forge another tenant's trace.
 */

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Accepted shape: 8–64 characters of ASCII alphanumerics, hyphen or underscore. A UUID passes.
 * Deliberately narrow — the point is a bounded identifier, not an arbitrary client string.
 */
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && VALID.test(value);
}

export function newCorrelationId(): string {
  return randomUUID();
}

export interface Resolution {
  correlationId: string;
  /** How the value was arrived at — worth logging, because a spike in `regenerated` is a signal. */
  source: 'client' | 'minted' | 'regenerated';
}

/**
 * Resolve the correlation ID for an inbound request.
 *
 * Header values can arrive as an array when a header is sent more than once; take the first and
 * validate it like any other input rather than joining them, because a repeated header is itself
 * a sign of something upstream being confused.
 */
export function resolveCorrelationId(headerValue: string | string[] | undefined): Resolution {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (raw === undefined || raw === '') {
    return { correlationId: newCorrelationId(), source: 'minted' };
  }
  if (isValidCorrelationId(raw)) {
    return { correlationId: raw, source: 'client' };
  }
  // Present but unusable. Do not sanitize and keep it — replace it. A partially cleaned
  // client string is still a client string, and the trace it joins is not yours.
  return { correlationId: newCorrelationId(), source: 'regenerated' };
}

/**
 * The headers to attach to an outbound call, so the ID survives the hop.
 *
 * Chapter 11 makes the same point about async boundaries, where it bites harder: brokers,
 * bridges and dead-letter requeues strip headers, so on those hops the ID has to travel in the
 * message payload instead. A correlation ID that survives only synchronous calls goes missing
 * at exactly the boundary where debugging is hardest.
 */
export function outboundHeaders(correlationId: string): Record<string, string> {
  if (!isValidCorrelationId(correlationId)) {
    throw new TypeError(`refusing to propagate an invalid correlation ID: ${correlationId}`);
  }
  return { [CORRELATION_HEADER]: correlationId };
}
