import { describe, expect, it } from 'vitest';
import {
  CORRELATION_HEADER,
  isValidCorrelationId,
  newCorrelationId,
  outboundHeaders,
  resolveCorrelationId,
} from '../src/correlation/correlation-id.js';

/**
 * "Generate at the edge, trust but verify", Chapter 2's rule, as three cases.
 *
 * The third case is the one teams skip: a *malformed* client ID must be replaced, not cleaned
 * up and kept. That is what makes this a security control rather than a convenience.
 */

describe('resolving an inbound correlation ID', () => {
  it('CLAIM: absent, the edge mints one', () => {
    const r = resolveCorrelationId(undefined);
    expect(r.source).toBe('minted');
    expect(isValidCorrelationId(r.correlationId)).toBe(true);
  });

  it('an empty header is treated as absent, not as a valid empty ID', () => {
    expect(resolveCorrelationId('').source).toBe('minted');
  });

  it('CLAIM: valid, preserved, so a client can trace end to end', () => {
    const supplied = 'b7c1f0e2-3a44-4c9b-9a1d-88f0c2e5a911';
    const r = resolveCorrelationId(supplied);
    expect(r.source).toBe('client');
    expect(r.correlationId).toBe(supplied);
  });

  it('CLAIM: malformed, REGENERATED, never passed through', () => {
    // Each of these is a real hazard rather than a hypothetical.
    const hostile = [
      'a',                                  // too short to be an identifier
      'x'.repeat(5000),                     // cardinality bomb / index blow-up
      'id with spaces',
      'id\nlevel=ERROR msg="fake entry"',   // log injection
      '../../etc/passwd',
      '<script>alert(1)</script>',
      'DROP TABLE orders;--',
      '💥-emoji-id',
    ];

    for (const value of hostile) {
      const r = resolveCorrelationId(value);
      expect(r.source, `should have regenerated: ${value.slice(0, 24)}`).toBe('regenerated');
      expect(r.correlationId).not.toBe(value);
      expect(isValidCorrelationId(r.correlationId)).toBe(true);
    }
  });

  it('a repeated header takes the first value and validates it like any other input', () => {
    // A header sent twice is itself a sign of something confused upstream; joining the values
    // would invent an ID that matches nothing on either side.
    const valid = newCorrelationId();
    expect(resolveCorrelationId([valid, 'second-value']).correlationId).toBe(valid);
    expect(resolveCorrelationId(['!!bad!!', valid]).source).toBe('regenerated');
  });

  it('minted IDs are unique', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newCorrelationId()));
    expect(ids.size).toBe(2000);
  });
});

describe('validation boundaries', () => {
  it('accepts the documented shape and rejects everything outside it', () => {
    expect(isValidCorrelationId('abcd1234')).toBe(true);        // 8 chars, the minimum
    expect(isValidCorrelationId('a'.repeat(64))).toBe(true);    // 64, the maximum
    expect(isValidCorrelationId('abcd123')).toBe(false);        // 7 - too short
    expect(isValidCorrelationId('a'.repeat(65))).toBe(false);   // 65 - too long
    expect(isValidCorrelationId('has_under-score')).toBe(true);
    expect(isValidCorrelationId('has.dot')).toBe(false);
    expect(isValidCorrelationId(undefined)).toBe(false);
    expect(isValidCorrelationId(12345678)).toBe(false);
  });
});

describe('propagating it outbound', () => {
  it('attaches the ID so it survives the hop', () => {
    const id = newCorrelationId();
    expect(outboundHeaders(id)).toEqual({ [CORRELATION_HEADER]: id });
  });

  it('refuses to propagate an invalid ID rather than silently corrupting the trace', () => {
    // Failing loudly here is deliberate: a trace that is quietly wrong is worse than one that
    // is obviously broken, because it gets trusted.
    expect(() => outboundHeaders('bad')).toThrow(TypeError);
    expect(() => outboundHeaders('id with spaces')).toThrow(TypeError);
  });

  it('CLAIM: an ID resolved at the edge survives every subsequent hop unchanged', () => {
    // The lifecycle from Figure 2.3: minted once at the edge, then carried verbatim.
    const edge = resolveCorrelationId(undefined);
    let carried = edge.correlationId;

    for (let hop = 0; hop < 6; hop++) {
      const headers = outboundHeaders(carried);
      const downstream = resolveCorrelationId(headers[CORRELATION_HEADER]);
      expect(downstream.source).toBe('client'); // trusted, because we sent it
      carried = downstream.correlationId;
    }

    expect(carried).toBe(edge.correlationId);
  });
});
