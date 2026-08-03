# Chapter 3: Security-First and Compliance-First Architecture

| | |
|---|---|
| [`prompts.md`](prompts.md) | The 4 Architect's Prompts from this chapter |
| [`../app/packages/security/`](../app/packages/security/) | Workload identity, default-deny policy, measurable blast radius |

## Where ShopFlow is at this point

Chapter 2 made the fleet horizontally scalable. Then someone found it.

| Metric | Stage 3 |
|--------|---------|
| Availability | **40.0%**, effectively down for real users, from resource exhaustion |
| Cloud spend | $4,000/mo, *paying to process bot traffic* |
| Active connections | **50,000+**, ~90% identified as malicious |

> **The Signal:** the perimeter has failed. A hard shell around a soft centre no longer protects
> anything, because the shell has been breached and the centre trusts whatever is inside it.

Note what the availability figure is measuring. The infrastructure is *healthy*; it is busy
serving attackers. 40% is availability for legitimate users, which is the only kind that counts.

## The three principles, as tests

Chapter 3 anchors on NIST SP 800-207. Each principle has a corresponding executable claim in
[`test/zero-trust.spec.ts`](../app/packages/security/test/zero-trust.spec.ts).

### Verify Explicitly: identity and context, never network location

`WorkloadIdentity` implements Figure 3.3's handshake. Cart has no password; it has an identity and
presents a short-lived token that Inventory verifies **on every call, even though both run inside
the same network**. That clause is the whole principle.

Every check is tested independently, because each one is a check an attacker gets to skip if you
leave it out:

| Attack | Refused as |
|---|---|
| Valid token for Inventory, replayed at Payments | `wrong-audience`, the confused-deputy check |
| Escalate `scope` in the payload and re-encode | `bad-signature` |
| Token minted with an attacker's own key | `bad-signature` |
| Expired token | `expired` (with bounded clock skew both ways) |
| Issuer starts minting 30-day tokens | `lifetime-too-long` |

That last one is worth dwelling on: **the verifier caps token lifetime regardless of what the
token claims.** A compromised or misconfigured issuer does not get to extend your exposure window.
"Short-lived" only means something if it is enforced where the token is used.

### Least Privilege: default deny, explicit grants

`PolicyEngine` is the allowlist. An unlisted call is *denied*, not logged-and-allowed, not
allowed-with-a-warning. Two design decisions are enforced at construction rather than at review,
because review is optional and construction is not:

- **A wildcard operation throws.** `operations: ['*']` is how an allowlist quietly becomes a
  denylist.
- **An unjustified grant throws.** An unexplained grant is one nobody dares remove, which is how
  allowlists only ever grow.

Authorization requires the grant to exist **and** the caller's verified token to carry the scope, two independent controls, so a policy mistake alone is not sufficient to authorize an action.

### Assume Breach: measure what one compromise reaches

This is where the metaphor becomes arithmetic. Pick a workload, assume it is compromised, count
what the attacker can reach:

| | Castle (perimeter) | Hotel (Zero Trust) |
|---|---|---|
| Compromise Catalog | **100% of the fleet** | nothing; it has no outbound grants |
| Compromise Orders (most privileged) | 100% | Inventory and Payments only |
| Worst case, any workload | **100%** | ≤ 2 of 6 |

The chapter's skeptic objects that mTLS adds ~20ms per hop, and they are right that it isn't free.
The last test in the file frames the actual comparison: not *20ms versus nothing*, but **20ms
versus total reachability from any single breach.**

## A deliberate warning in the code

`workload-identity.ts` carries a prominent note saying **do not use it.** In production you want
your platform's workload identity (IAM roles, managed identities, SPIFFE/SPIRE) and a vetted JWT
library. Rolling your own token format is how signature-verification bugs ship.

It exists here so every verification step is visible and individually testable. A security chapter
whose sample code invites copy-paste into production has done harm, and the honest fix is to say so
in the file rather than in a footnote.

## Running it

```bash
cd ../app
npm install
npm test          # all three principles, no infrastructure needed
```

Real Ed25519 signing via `node:crypto`, with no dependencies, and the signature tests are genuine
cryptographic verification rather than string comparison.

## What is still open

The bot traffic itself. Zero Trust stops a breach from spreading; it does nothing about 50,000
connections of hostile-but-unauthenticated load, and neither does this code. Tiered rate limiting
and load shedding arrive in Chapter 12, and the edge defences that keep that traffic away from the
origin at all are Chapter 4.

Chapter 3's own note is that the site came back not because the attackers were blocked but because
they stopped being *useful*: every door they reached needed a key card they did not have.

## Where this goes next

The fleet is now segmented and mutually authenticated, and it is still serving every request from
its origin in one region. Chapter 4 moves the work to the edge.
