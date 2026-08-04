/**
 * Replication and RPO, made precise.
 *
 * The claim "synchronous replication gives zero RPO" is the one that needed correcting during
 * review, and the correction is worth encoding because the imprecise version is what most teams
 * believe:
 *
 *   Synchronous replication to ONE replica gives zero RPO for a single-node failure. It does not
 *   give zero RPO in general. A correlated loss of the primary and that replica together, which is
 *   what a rack, an availability zone, or a bad deploy produces, still loses committed writes.
 *   True zero RPO needs a quorum of two or more synchronous replicas.
 *
 * The distinction matters because the failure that takes out one node usually takes out its
 * neighbour, and "zero RPO" written in a design doc tends to be read as "we cannot lose data".
 */

export type ReplicationMode = 'async' | 'sync';

export interface ReplicationTopology {
  mode: ReplicationMode;
  /** Replicas that must acknowledge before a write is considered committed. */
  syncReplicas: number;
  /** Replicas receiving writes without blocking the commit. */
  asyncReplicas: number;
  /** True when replicas are spread across independent failure domains. */
  acrossFailureDomains: boolean;
  /** Observed lag on the async replicas, in ms. ShopFlow: 8 to 45 seconds. */
  asyncLagCeilingMs: number;
}

export type FailureScenario =
  | 'single-node'
  /** A rack, an availability zone, or a bad deploy that takes primary and a replica together. */
  | 'correlated-pair'
  | 'whole-region';

export interface RpoAssessment {
  /** Recovery point objective in ms. 0 means no committed write is lost. */
  rpoMs: number;
  dataLoss: boolean;
  explanation: string;
}

export function assessRpo(t: ReplicationTopology, scenario: FailureScenario): RpoAssessment {
  if (t.mode === 'async' || t.syncReplicas === 0) {
    return {
      rpoMs: t.asyncLagCeilingMs,
      dataLoss: true,
      explanation:
        `asynchronous replication commits before the replica acknowledges, so up to ` +
        `${t.asyncLagCeilingMs}ms of committed writes are lost in any failover`,
    };
  }

  if (scenario === 'single-node') {
    return {
      rpoMs: 0,
      dataLoss: false,
      explanation:
        'one synchronous replica acknowledged every committed write, so a single-node failure loses nothing',
    };
  }

  if (scenario === 'correlated-pair') {
    if (t.syncReplicas >= 2 && t.acrossFailureDomains) {
      return {
        rpoMs: 0,
        dataLoss: false,
        explanation:
          'a quorum of two or more synchronous replicas across independent failure domains survives ' +
          'the loss of the primary and one replica together',
      };
    }
    return {
      rpoMs: t.asyncLagCeilingMs,
      dataLoss: true,
      explanation:
        'the primary and its only synchronous replica were lost together, which is what a rack, an ' +
        'availability zone or a bad deploy produces. Committed writes are gone. This is why ' +
        '"synchronous replication gives zero RPO" is only true for a single-node failure',
    };
  }

  // Whole region.
  return {
    rpoMs: t.acrossFailureDomains && t.syncReplicas >= 2 ? t.asyncLagCeilingMs : Infinity,
    dataLoss: true,
    explanation:
      'surviving a whole-region loss requires synchronous replication across regions, which pays ' +
      'the inter-region round trip on every commit. Almost nobody accepts that, so regional RPO is ' +
      'a business decision rather than a configuration',
  };
}

/**
 * The honest summary a design document should carry, rather than the phrase "zero RPO".
 */
export function rpoStatement(t: ReplicationTopology): string {
  const single = assessRpo(t, 'single-node');
  const pair = assessRpo(t, 'correlated-pair');
  return (
    `RPO: ${single.rpoMs}ms for a single-node failure; ` +
    `${pair.rpoMs === Infinity ? 'total loss' : pair.rpoMs + 'ms'} for a correlated primary-plus-replica failure.`
  );
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Search freshness, fed by change data capture.
 *
 * ShopFlow moves product search off a `LIKE '%term%'` scan onto Elasticsearch, fed by CDC at 2 to
 * 10 seconds of freshness. That lag is a contract, not an implementation detail: anything that
 * cannot tolerate ten seconds of staleness must not be answered from the search index.
 *
 * Real-time stock is the case that decides it, and it is the same conclusion Chapter 9 reached about
 * caching it: the cost of being wrong is a customer buying something that does not exist.
 */
export interface SearchIntent {
  name: string;
  toleratedStalenessMs: number;
}

export const CDC_FRESHNESS_CEILING_MS = 10_000;

export function canServeFromSearchIndex(intent: SearchIntent): { ok: boolean; reason: string } {
  if (intent.toleratedStalenessMs >= CDC_FRESHNESS_CEILING_MS) {
    return { ok: true, reason: `tolerates the ${CDC_FRESHNESS_CEILING_MS}ms CDC freshness ceiling` };
  }
  return {
    ok: false,
    reason:
      `requires fresher than ${CDC_FRESHNESS_CEILING_MS}ms, which CDC cannot guarantee. ` +
      `Serve it from the authoritative store, the same conclusion Chapter 9 reached about caching stock`,
  };
}
