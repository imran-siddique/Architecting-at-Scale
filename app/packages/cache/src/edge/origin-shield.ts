import { SingleFlight } from '../single-flight.js';

/**
 * Figure 4.1: the Origin Shield versus the Thundering Herd.
 *
 * Chapter 4's scenario: 50,000 users hit a popular product drop, the edge entry expires at that
 * exact millisecond, and every one of those requests goes past the edge to the origin at once.
 * The origin is the "Single Straw" and it does not survive.
 *
 * The shield is a mid-tier that every point of presence fetches through, so the whole fleet's
 * misses collapse into one origin read. Note that this is the same mechanism as Chapter 9's
 * single-flight, applied one tier up, which is the useful observation, because it means the
 * herd is not an edge problem or a cache problem but a property of any tier that fronts a
 * slower one. Wherever you have a fan-in, you need a collapse.
 *
 * Two tiers of collapse are required and neither is sufficient alone:
 *   - Per-PoP: many users of ONE PoP asking for the same key produce one shield request.
 *   - At the shield: many PoPs asking for the same key produce one ORIGIN request.
 */

export interface EdgeEntry {
  body: string;
  /** Epoch ms after which the entry is stale. */
  staleAt: number;
  /** Epoch ms after which it may no longer be served even in a degraded mode. */
  expiresAt: number;
}

export interface ShieldMetrics {
  popHits: number;
  popMisses: number;
  shieldHits: number;
  originFetches: number;
  /** Times a stale entry was served because the origin could not be reached. */
  staleServed: number;
  /** Times nothing could be served at all. The only case a customer sees an error. */
  hardFailures: number;
}

export interface OriginShieldOptions {
  popCount: number;
  /** How long an entry is fresh. */
  ttlMs: number;
  /**
   * How long past `staleAt` an entry may still be served while a refresh is attempted, or if
   * the origin is unreachable. This is Chapter 4's Golden Rule made mechanical: availability
   * beats freshness. A 60-second-old price beats a 404.
   */
  staleWhileRevalidateMs: number;
  now?: () => number;
}

/**
 * A two-tier edge with an origin shield. Deliberately in-memory and single-process: it models
 * the routing and collapse behaviour, which is what the chapter's claims are about, without
 * pretending to be a CDN.
 */
export class OriginShield {
  private readonly pops: Array<Map<string, EdgeEntry>>;
  private readonly shieldCache = new Map<string, EdgeEntry>();
  private readonly popFlights: Array<SingleFlight<EdgeEntry | null>>;
  private readonly shieldFlight = new SingleFlight<EdgeEntry | null>();
  private readonly now: () => number;

  readonly metrics: ShieldMetrics = {
    popHits: 0,
    popMisses: 0,
    shieldHits: 0,
    originFetches: 0,
    staleServed: 0,
    hardFailures: 0,
  };

  constructor(private readonly opts: OriginShieldOptions) {
    this.pops = Array.from({ length: opts.popCount }, () => new Map());
    this.popFlights = Array.from({ length: opts.popCount }, () => new SingleFlight<EdgeEntry | null>());
    this.now = opts.now ?? Date.now;
  }

  /**
   * Fetch `key` via `popIndex`. `origin` is the only thing that can actually produce data, and
   * every layer above exists to call it as rarely as possible.
   *
   * Returns the body, or null when nothing can be served, which should be vanishingly rare,
   * because a stale entry is preferred over a failure.
   */
  async get(popIndex: number, key: string, origin: () => Promise<string>): Promise<string | null> {
    const pop = this.pops[popIndex]!;
    const t = this.now();

    const local = pop.get(key);
    if (local && t < local.staleAt) {
      this.metrics.popHits++;
      return local.body;
    }
    this.metrics.popMisses++;

    // Tier 1 collapse: everyone at THIS PoP waiting on the same key shares one upstream call.
    const entry = await this.popFlights[popIndex]!.run(key, async () => {
      const fresh = await this.viaShield(key, origin);
      if (fresh) pop.set(key, fresh);
      return fresh;
    });

    if (entry && this.now() < entry.staleAt) return entry.body;

    // Serve stale rather than failing. Availability beats freshness.
    const fallback = entry ?? local;
    if (fallback && this.now() < fallback.expiresAt) {
      this.metrics.staleServed++;
      return fallback.body;
    }

    this.metrics.hardFailures++;
    return null;
  }

  /** Tier 2 collapse: every PoP asking for the same key shares one origin fetch. */
  private async viaShield(key: string, origin: () => Promise<string>): Promise<EdgeEntry | null> {
    const t = this.now();
    const shielded = this.shieldCache.get(key);
    if (shielded && t < shielded.staleAt) {
      this.metrics.shieldHits++;
      return shielded;
    }

    return this.shieldFlight.run(key, async () => {
      // Re-check: a concurrent winner may already have refreshed it.
      const again = this.shieldCache.get(key);
      if (again && this.now() < again.staleAt) {
        this.metrics.shieldHits++;
        return again;
      }
      try {
        this.metrics.originFetches++;
        const body = await origin();
        const at = this.now();
        const entry: EdgeEntry = {
          body,
          staleAt: at + this.opts.ttlMs,
          expiresAt: at + this.opts.ttlMs + this.opts.staleWhileRevalidateMs,
        };
        this.shieldCache.set(key, entry);
        return entry;
      } catch {
        // The origin is down. Hand back whatever we have, however old, and let the caller
        // decide whether it is still inside its stale window. Throwing here would convert a
        // recoverable degradation into an outage.
        return this.shieldCache.get(key) ?? null;
      }
    });
  }
}
