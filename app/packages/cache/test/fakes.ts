import type { CacheStore, Clock, Metrics, PurgeTarget } from '../src/ports.js';

/**
 * In-memory doubles so the suite runs with no infrastructure. `npm test` must pass on a
 * laptop with nothing installed — if proving the chapter's claims requires Docker, nobody
 * will run the proof.
 */

export class MemoryStore implements CacheStore {
  private readonly map = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly clock: Clock) {}

  private live(key: string) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.clock.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.map.set(key, { value, expiresAt: this.clock.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.map.delete(k)) n++;
    return n;
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  /** Test-only: expire a key without deleting it, to simulate TTL elapse. */
  expire(key: string) {
    const e = this.map.get(key);
    if (e) e.expiresAt = 0;
  }

  get size() {
    return this.map.size;
  }
}

export class TestClock implements Clock {
  constructor(private t = 1_700_000_000_000) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export class RecordingPurgeTarget implements PurgeTarget {
  readonly purged: string[][] = [];
  constructor(
    readonly name: string,
    private readonly failWith?: Error,
  ) {}
  async purge(paths: string[]) {
    if (this.failWith) throw this.failWith;
    this.purged.push(paths);
  }
}

export function countingMetrics() {
  const counts = {
    hit: 0,
    miss: 0,
    coalesced: 0,
    staleInvalidation: 0,
    lags: [] as number[],
  };
  const metrics: Metrics = {
    hit: () => void counts.hit++,
    miss: () => void counts.miss++,
    coalesced: () => void counts.coalesced++,
    staleInvalidation: () => void counts.staleInvalidation++,
    invalidationLag: (_ks, ms) => void counts.lags.push(ms),
  };
  return { metrics, counts };
}
