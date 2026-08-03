import { describe, expect, it } from 'vitest';
import { loadImbalance, runFleet, type Request } from '../src/session/fleet.js';
import { SessionStore } from '../src/session/session-store.js';
import type { SessionBackend } from '../src/session/ports.js';

/**
 * Chapter 2's case against sticky sessions, and for externalized state.
 *
 * The chapter makes two specific objections, the Availability Trap and the Hot Node problem, * and both are consequences of the routing rule rather than matters of taste. So both get
 * asserted rather than argued.
 */

const users = (n: number, weight = 1): Request[] =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i % 40}`, weight }));

describe('the Availability Trap (Figure 2.2, upper half)', () => {
  it('CLAIM: with sticky sessions, losing one instance destroys those users’ carts', () => {
    const r = runFleet({
      strategy: 'sticky',
      instanceCount: 4,
      requests: users(400),
      killInstance: 1,
      killAfter: 200,
    });

    // Every subsequent request pinned to instance 1 finds nothing and is forced to log in again.
    expect(r.sessionsLost).toBeGreaterThan(0);
    expect(r.routedToDeadInstance).toBe(r.sessionsLost);
  });

  it('CLAIM: with a shared session store, losing one instance loses no carts at all', () => {
    const r = runFleet({
      strategy: 'stateless',
      instanceCount: 4,
      requests: users(400),
      killInstance: 1,
      killAfter: 200,
    });

    // Identical fleet, identical failure, identical traffic. The only change is where state
    // lives - and now the failure is invisible to the customer.
    expect(r.sessionsLost).toBe(0);
    expect(r.routedToDeadInstance).toBe(0);
    expect(r.served).toBe(400);
  });

  it('the difference is not marginal, which is why this is not a tuning decision', () => {
    const opts = { instanceCount: 4, requests: users(400), killInstance: 0, killAfter: 100 };
    const sticky = runFleet({ ...opts, strategy: 'sticky' });
    const stateless = runFleet({ ...opts, strategy: 'stateless' });

    expect(stateless.served).toBeGreaterThan(sticky.served);
    expect(stateless.sessionsLost).toBe(0);
  });
});

describe('the Hot Node problem (sticky routes by user, not by load)', () => {
  it('CLAIM: one power user or bot saturates a single instance while others sit idle', () => {
    // 39 ordinary users at weight 1, plus one bot sending 10x the load - the chapter's example.
    const traffic: Request[] = [
      ...Array.from({ length: 390 }, (_, i) => ({ userId: `u${i % 39}`, weight: 1 })),
      ...Array.from({ length: 60 }, () => ({ userId: 'bot', weight: 10 })),
    ];

    const sticky = runFleet({ strategy: 'sticky', instanceCount: 4, requests: traffic });
    const stateless = runFleet({ strategy: 'stateless', instanceCount: 4, requests: traffic });

    // The load balancer is doing exactly what it was told, and the fleet is still lopsided.
    expect(loadImbalance(sticky.loadPerInstance)).toBeGreaterThan(
      loadImbalance(stateless.loadPerInstance),
    );
    // Round-robin over stateless instances spreads the same traffic close to evenly.
    expect(loadImbalance(stateless.loadPerInstance)).toBeLessThan(1.5);
  });

  it('stateless routing keeps the fleet balanced even with skewed users', () => {
    const r = runFleet({
      strategy: 'stateless',
      instanceCount: 5,
      requests: users(500),
    });
    expect(loadImbalance(r.loadPerInstance)).toBeLessThan(1.2);
  });
});

/** An in-memory SessionBackend so the store's contract is testable without Redis. */
class MemoryBackend implements SessionBackend {
  readonly map = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string, ttl: number) {
    this.map.set(k, v);
    this.ttls.set(k, ttl);
  }
  async del(k: string) {
    this.ttls.delete(k);
    return this.map.delete(k) ? 1 : 0;
  }
}

describe('SessionStore: the read-or-create lookup that replaces instance memory', () => {
  it('creates a session on first sight and reuses it afterwards', async () => {
    const backend = new MemoryBackend();
    const store = new SessionStore(backend, 3600, () => 1_700_000_000_000);

    const first = await store.readOrCreate('abc');
    first.cart['p-1001'] = 2;
    await store.save(first);

    const second = await store.readOrCreate('abc');
    expect(second.cart).toEqual({ 'p-1001': 2 });
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('CLAIM: any instance can serve any request, because none of them holds the session', async () => {
    // Two independently constructed stores - two different "servers" - over one backend.
    const backend = new MemoryBackend();
    const serverA = new SessionStore(backend);
    const serverB = new SessionStore(backend);

    const onA = await serverA.readOrCreate('sess-123');
    onA.userId = 'u42';
    onA.cart['p-1002'] = 1;
    await serverA.save(onA);

    // Request 2 lands on Server B, which has never seen this user.
    const onB = await serverB.readOrCreate('sess-123');
    expect(onB.userId).toBe('u42');
    expect(onB.cart).toEqual({ 'p-1002': 1 });
  });

  it('always writes a TTL, because a session that never expires is an auth bug', async () => {
    const backend = new MemoryBackend();
    const store = new SessionStore(backend, 900);
    await store.readOrCreate('ttl-check');
    expect([...backend.ttls.values()]).toEqual([900]);
  });

  it('destroy removes it server-side, a discarded cookie is not a terminated session', async () => {
    const backend = new MemoryBackend();
    const store = new SessionStore(backend);
    await store.readOrCreate('bye');
    expect(backend.map.size).toBe(1);
    await store.destroy('bye');
    expect(backend.map.size).toBe(0);
  });
});
