import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_SECONDS,
  MAX_TOKEN_LIFETIME_SECONDS,
  WorkloadIdentity,
  generateIssuerKeys,
} from '../src/workload-identity.js';
import { PolicyEngine, SHOPFLOW_GRANTS } from '../src/policy.js';
import { perimeterBlastRadius, zeroTrustBlastRadius } from '../src/blast-radius.js';

/**
 * Chapter 3's three principles, as assertions.
 *
 *   Verify Explicitly - identity and context, never network location
 *   Least Privilege   - default deny, explicit grants, no wildcards
 *   Assume Breach     - measure what one compromised workload can reach
 */

const ISSUER = 'https://identity.shopflow.internal';
const keys = generateIssuerKeys();
const issuer = new WorkloadIdentity({ issuer: ISSUER, ...keys });
const verifier = new WorkloadIdentity({ issuer: ISSUER, publicKeyPem: keys.publicKeyPem });

const T0 = 1_700_000_000_000;
const at = (ms: number) => () => ms;

const cartToken = (over: { aud?: string; scope?: string[]; lifetime?: number } = {}) =>
  issuer.mint(
    { sub: 'cart', aud: over.aud ?? 'inventory', scope: over.scope ?? ['stock.read'] },
    over.lifetime ?? 300,
    at(T0),
  );

describe('Verify Explicitly: the workload identity handshake (Figure 3.3)', () => {
  it('accepts a correctly signed, in-date token for the right audience', () => {
    const r = verifier.verifyToken(cartToken(), 'inventory', at(T0 + 1000));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.sub).toBe('cart');
      expect(r.claims.scope).toEqual(['stock.read']);
    }
  });

  it('CLAIM: a token for a DIFFERENT service is refused — the confused-deputy check', () => {
    // A valid, unexpired, correctly signed token that was issued for Inventory. Payments must
    // refuse it, or any service holding a token can replay it anywhere in the fleet.
    const forInventory = cartToken({ aud: 'inventory' });
    const r = verifier.verifyToken(forInventory, 'payments', at(T0 + 1000));
    expect(r).toEqual({ ok: false, reason: 'wrong-audience' });
  });

  it('CLAIM: an expired token is refused — this is what makes theft survivable', () => {
    const token = cartToken({ lifetime: 300 });
    // Inside the window, fine. Past it plus the skew allowance, refused.
    expect(verifier.verifyToken(token, 'inventory', at(T0 + 299_000)).ok).toBe(true);
    expect(verifier.verifyToken(token, 'inventory', at(T0 + 400_000))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('tolerates modest clock skew in both directions, but not unbounded skew', () => {
    const token = cartToken({ lifetime: 60 });
    // Just past expiry but inside the skew allowance.
    expect(verifier.verifyToken(token, 'inventory', at(T0 + 60_000 + (CLOCK_SKEW_SECONDS - 5) * 1000)).ok).toBe(true);
    // A verifier whose clock is far behind the issuer's.
    expect(verifier.verifyToken(token, 'inventory', at(T0 - 600_000))).toEqual({
      ok: false,
      reason: 'not-yet-valid',
    });
  });

  it('CLAIM: a tampered payload fails the signature, even by one character', () => {
    const token = cartToken({ scope: ['stock.read'] });
    const [payload, sig] = token.split('.') as [string, string];

    // Escalate the scope and re-encode. The payload is readable; that was never the protection.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.scope = ['stock.read', 'stock.reserve', 'payment.capture'];
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');

    expect(verifier.verifyToken(`${forged}.${sig}`, 'inventory', at(T0))).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('a token signed by a DIFFERENT issuer key is refused', () => {
    // The scenario that matters: an attacker who can mint tokens, but not with your key.
    const attacker = new WorkloadIdentity({ issuer: ISSUER, ...generateIssuerKeys() });
    const forged = attacker.mint({ sub: 'cart', aud: 'inventory', scope: ['payment.capture'] }, 300, at(T0));
    expect(verifier.verifyToken(forged, 'inventory', at(T0)).ok).toBe(false);
  });

  it('CLAIM: the verifier caps token lifetime, so a bad issuer cannot extend exposure', () => {
    // A misconfigured or compromised issuer starts minting 30-day tokens. The verifier refuses
    // them regardless of the signature being valid - a defence the issuer cannot weaken.
    const longLived = issuer.mint(
      { sub: 'cart', aud: 'inventory', scope: ['stock.read'] },
      MAX_TOKEN_LIFETIME_SECONDS + 60,
      at(T0),
    );
    expect(verifier.verifyToken(longLived, 'inventory', at(T0 + 1000))).toEqual({
      ok: false,
      reason: 'lifetime-too-long',
    });
  });

  it('rejects malformed input rather than throwing', () => {
    for (const junk of ['', 'not-a-token', 'a.b.c', '.', 'YWJj.']) {
      const r = verifier.verifyToken(junk, 'inventory', at(T0));
      expect(r.ok).toBe(false);
    }
  });
});

describe('Least Privilege: default-deny authorization', () => {
  const policy = new PolicyEngine(SHOPFLOW_GRANTS);

  it('CLAIM: an unlisted call is DENIED, not logged-and-allowed', () => {
    expect(policy.decide({ caller: 'catalog', callee: 'payments', operation: 'payment.capture' }))
      .toEqual({ allow: false, reason: 'no-matching-grant' });
  });

  it('permits exactly what is granted, and nothing adjacent to it', () => {
    expect(policy.decide({ caller: 'cart', callee: 'inventory', operation: 'stock.read' }).allow).toBe(true);
    // Same pair, an operation nobody granted.
    expect(policy.decide({ caller: 'cart', callee: 'inventory', operation: 'stock.delete' }))
      .toEqual({ allow: false, reason: 'operation-not-granted' });
  });

  it('CLAIM: adding a new service grants it nothing implicitly', () => {
    // This is what makes Assume Breach tractable. A new workload - or a compromised one that
    // renames itself - inherits no reachability.
    for (const callee of ['inventory', 'payments', 'auth', 'catalog']) {
      expect(policy.decide({ caller: 'new-recommendations-service', callee, operation: 'stock.read' }).allow)
        .toBe(false);
    }
  });

  it('requires the caller to hold the scope AND the grant to exist', () => {
    // Two independent controls, so a policy mistake alone is not enough to authorize.
    expect(policy.decide({
      caller: 'orders', callee: 'payments', operation: 'payment.capture',
      callerScopes: ['payment.authorize'],
    })).toEqual({ allow: false, reason: 'scope-not-held' });

    expect(policy.decide({
      caller: 'orders', callee: 'payments', operation: 'payment.capture',
      callerScopes: ['payment.authorize', 'payment.capture'],
    }).allow).toBe(true);
  });

  it('refuses a wildcard grant at construction time', () => {
    // A wildcard is how an allowlist quietly becomes a denylist. Caught here rather than at
    // review, because review is optional and construction is not.
    expect(() => new PolicyEngine([
      { caller: 'a', callee: 'b', operations: ['*'], justification: 'convenience' },
    ])).toThrow(/wildcard/);
  });

  it('refuses an empty or unjustified grant', () => {
    expect(() => new PolicyEngine([
      { caller: 'a', callee: 'b', operations: [], justification: 'x' },
    ])).toThrow(/empty grant/);
    expect(() => new PolicyEngine([
      { caller: 'a', callee: 'b', operations: ['read'], justification: '  ' },
    ])).toThrow(/no justification/);
  });

  it('only Orders can move money', () => {
    const movers = ['api-gateway', 'catalog', 'cart', 'inventory', 'auth'];
    for (const caller of movers) {
      expect(policy.decide({ caller, callee: 'payments', operation: 'payment.capture' }).allow).toBe(false);
    }
    expect(policy.decide({ caller: 'orders', callee: 'payments', operation: 'payment.capture' }).allow).toBe(true);
  });
});

describe('Assume Breach: the blast radius is measurable (Figure 3.1)', () => {
  const fleet = ['api-gateway', 'auth', 'catalog', 'cart', 'inventory', 'orders', 'payments'];
  const policy = new PolicyEngine(SHOPFLOW_GRANTS);

  it('CLAIM: in the castle, one compromised workload reaches the ENTIRE fleet', () => {
    const r = perimeterBlastRadius(fleet, 'catalog');
    expect(r.fraction).toBe(1);
    expect(r.reachable).toHaveLength(fleet.length - 1);
  });

  it('CLAIM: in the hotel, the same compromise reaches only what that identity was granted', () => {
    const castle = perimeterBlastRadius(fleet, 'catalog');
    const hotel = zeroTrustBlastRadius(fleet, 'catalog', policy);

    // Catalog is granted nothing outbound, so compromising it reaches nothing at all.
    expect(hotel.reachable).toEqual([]);
    expect(hotel.fraction).toBeLessThan(castle.fraction);
  });

  it('even the most privileged workload has a bounded radius', () => {
    // Orders is the most connected service in the allowlist, and still cannot reach everything.
    const hotel = zeroTrustBlastRadius(fleet, 'orders', policy);
    expect(hotel.reachable.sort()).toEqual(['inventory', 'payments']);
    expect(hotel.fraction).toBeLessThan(1);
  });

  it('this difference is the return on the ~20ms mTLS cost the skeptic objects to', () => {
    // The chapter's skeptic is right that mTLS is not free. The comparison is not
    // "20ms versus nothing", it is "20ms versus total reachability from any single breach".
    const worstCastle = Math.max(
      ...fleet.map((w) => perimeterBlastRadius(fleet, w).fraction),
    );
    const worstHotel = Math.max(
      ...fleet.map((w) => zeroTrustBlastRadius(fleet, w, policy).fraction),
    );
    expect(worstCastle).toBe(1);
    expect(worstHotel).toBeLessThanOrEqual(2 / (fleet.length - 1));
  });
});
