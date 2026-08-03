import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Figure 3.3: the Workload Identity Handshake.
 *
 * Chapter 3's most contrarian move is getting out of the secret business. The Cart service does
 * not have a password; it has an identity, and it presents a short-lived token that the Inventory
 * service verifies on every call — even though both run inside the same network. That last clause
 * is the whole of Verify Explicitly: trust comes from identity and context, never from network
 * location.
 *
 * Short-lived is the other half. If an attacker steals a token, it expires before they work out
 * what to do with it. A shared secret that lives in an environment variable expires when someone
 * remembers to rotate it, which is to say never.
 *
 * ------------------------------------------------------------------------------------------
 * NOTE ON USING THIS: do not. In production, use your platform's workload identity (IAM roles,
 * managed identities, SPIFFE/SPIRE) and a vetted JWT library. Rolling your own token format is
 * how signature-verification bugs get shipped. This exists so the verification steps are visible
 * and individually testable — every check below is one an attacker gets to skip if you omit it.
 * ------------------------------------------------------------------------------------------
 */

export interface WorkloadClaims {
  /** Who is calling. The workload's identity, not a user's. */
  sub: string;
  /** Who issued it — the platform identity provider. */
  iss: string;
  /** Who it is FOR. A token for the Inventory service must not be accepted by Payments. */
  aud: string;
  /** Operations this identity is permitted to request. Least privilege, expressed in the token. */
  scope: string[];
  /** Issued-at and expiry, both in epoch seconds. */
  iat: number;
  exp: number;
}

export type VerifyFailure =
  | 'malformed'
  | 'bad-signature'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'expired'
  | 'not-yet-valid'
  | 'lifetime-too-long';

export type VerifyResult =
  | { ok: true; claims: WorkloadClaims }
  | { ok: false; reason: VerifyFailure };

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

export interface IdentityProviderOptions {
  issuer: string;
  /** Ed25519 key pair. In production this is the platform's, and you never see the private half. */
  privateKeyPem?: string;
  publicKeyPem?: string;
}

/** Generates a fresh Ed25519 key pair. Test and local-development convenience only. */
export function generateIssuerKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * The maximum lifetime a verifier will accept, regardless of what the token claims.
 *
 * This is a defence the issuer cannot weaken. A compromised or misconfigured issuer that starts
 * minting 30-day tokens does not get to extend your exposure window, because the verifier refuses
 * them. Chapter 3's standard for machine-to-machine traffic is short-lived, and "short" has to be
 * enforced at the point of use to mean anything.
 */
export const MAX_TOKEN_LIFETIME_SECONDS = 15 * 60;

/** Tolerated clock difference between issuer and verifier. */
export const CLOCK_SKEW_SECONDS = 30;

export class WorkloadIdentity {
  private readonly issuer: string;
  private readonly privateKeyPem?: string;
  private readonly publicKeyPem?: string;

  constructor(opts: IdentityProviderOptions) {
    this.issuer = opts.issuer;
    this.privateKeyPem = opts.privateKeyPem;
    this.publicKeyPem = opts.publicKeyPem;
  }

  /** Mint a token for `sub` to call `aud`. The issuer side of the handshake. */
  mint(
    claims: Omit<WorkloadClaims, 'iss' | 'iat' | 'exp'>,
    lifetimeSeconds = 300,
    now: () => number = Date.now,
  ): string {
    if (!this.privateKeyPem) throw new Error('no private key: this instance can only verify');
    const iat = Math.floor(now() / 1000);
    const full: WorkloadClaims = {
      ...claims,
      iss: this.issuer,
      iat,
      exp: iat + lifetimeSeconds,
    };
    const payload = b64u(Buffer.from(JSON.stringify(full)));
    const signature = sign(null, Buffer.from(payload), createPrivateKey(this.privateKeyPem));
    return `${payload}.${b64u(signature)}`;
  }

  /**
   * The verifier side. Every check here is one an attacker gets to skip if you leave it out, so
   * they are ordered cheapest-first and none of them is optional.
   *
   * `audience` is the verifying service's own identity. Passing it explicitly rather than reading
   * it from the token is the point: a token is only valid for the service it was issued to.
   */
  verifyToken(
    token: string,
    audience: string,
    now: () => number = Date.now,
  ): VerifyResult {
    if (!this.publicKeyPem) throw new Error('no public key: cannot verify');

    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed' };
    const [payload, signature] = parts as [string, string];

    // Signature first. Nothing inside an unverified payload is worth reading, including the
    // fields you would use to decide how to read it.
    let signatureValid = false;
    try {
      signatureValid = verify(
        null,
        Buffer.from(payload),
        createPublicKey(this.publicKeyPem),
        unb64u(signature),
      );
    } catch {
      return { ok: false, reason: 'bad-signature' };
    }
    if (!signatureValid) return { ok: false, reason: 'bad-signature' };

    let claims: WorkloadClaims;
    try {
      claims = JSON.parse(unb64u(payload).toString()) as WorkloadClaims;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.iss !== 'string' ||
      typeof claims.aud !== 'string' ||
      !Array.isArray(claims.scope) ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }

    if (claims.iss !== this.issuer) return { ok: false, reason: 'wrong-issuer' };
    // The confused-deputy check. A valid, unexpired, correctly signed token for a DIFFERENT
    // service must be refused, or any service holding a token can replay it anywhere.
    if (claims.aud !== audience) return { ok: false, reason: 'wrong-audience' };

    if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
      return { ok: false, reason: 'lifetime-too-long' };
    }

    const seconds = Math.floor(now() / 1000);
    if (seconds > claims.exp + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'expired' };
    if (seconds < claims.iat - CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not-yet-valid' };

    return { ok: true, claims };
  }
}
