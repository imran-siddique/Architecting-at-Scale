import type { PolicyEngine } from './policy.js';

/**
 * Figure 3.1: Perimeter Defense (the Castle) versus Zero Trust (the Hotel).
 *
 * The chapter's metaphor is a hard shell around a soft centre versus a building where every door
 * needs a key card. That difference is measurable rather than rhetorical: pick a workload, assume
 * it is compromised, and count what the attacker can reach.
 *
 * Assume Breach is the third Zero Trust principle, and this is what it means operationally - you
 * do not ask whether a node will be compromised, you ask what happens when one is.
 */

export interface BlastRadius {
  /** Workloads the attacker can reach from the compromised one. */
  reachable: string[];
  /** As a share of the fleet. 1.0 means the whole system. */
  fraction: number;
}

/**
 * The castle. Once inside the perimeter, every workload is reachable, because trust was granted
 * by network location and the attacker is now at a trusted location.
 *
 * This is not a straw man: it is the default for any system where services talk to each other
 * without authenticating, which is most systems that grew up behind a firewall.
 */
export function perimeterBlastRadius(fleet: string[], compromised: string): BlastRadius {
  const reachable = fleet.filter((w) => w !== compromised);
  return { reachable, fraction: reachable.length / (fleet.length - 1) };
}

/**
 * The hotel. The attacker holds one workload's identity, so they can reach exactly what that
 * identity was explicitly granted - and nothing else, because every callee verifies identity per
 * request instead of inferring it from the source address.
 *
 * `depth` follows the grant graph transitively: a compromised workload can call what it is
 * allowed to call, and from there whatever THOSE identities are allowed to call only if it can
 * also obtain their tokens. It cannot, which is why the default depth is 1 - and why that
 * single fact is the entire return on the mTLS latency the chapter's skeptic objects to.
 */
export function zeroTrustBlastRadius(
  fleet: string[],
  compromised: string,
  policy: PolicyEngine,
  depth = 1,
): BlastRadius {
  const seen = new Set<string>();
  let frontier = [compromised];

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const caller of frontier) {
      for (const callee of policy.reachableFrom(caller)) {
        if (callee !== compromised && !seen.has(callee)) {
          seen.add(callee);
          next.push(callee);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  const reachable = [...seen];
  return { reachable, fraction: reachable.length / (fleet.length - 1) };
}
