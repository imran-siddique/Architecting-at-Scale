/**
 * Figure 2.2, executable: sticky sessions versus a stateless fleet with a shared session store.
 *
 * Chapter 2 argues that sticky sessions are a quick fix that trades one problem for two — the
 * Hot Node problem and the Availability Trap. Both are consequences of the routing rule rather
 * than opinions about it, so both can be modelled and asserted.
 *
 * The model is deliberately small. It routes requests, holds session state in the place the
 * strategy says it lives, kills an instance, and reports what survived. That is enough to make
 * the chapter's two objections concrete.
 */

export type Strategy = 'sticky' | 'stateless';

export interface Cart {
  userId: string;
  items: number;
}

export interface FleetResult {
  /** Requests that found their session and were served correctly. */
  served: number;
  /** Requests whose session was lost — the user is logged out, cart empty. */
  sessionsLost: number;
  /** Per-instance request counts. The spread is the Hot Node signal. */
  loadPerInstance: number[];
  /** Requests routed to an instance that was already dead. */
  routedToDeadInstance: number;
}

export interface Request {
  userId: string;
  /** Weight in units of work. A power user or a bot sends far more than 1. */
  weight?: number;
}

/**
 * Run `requests` against a fleet of `instanceCount` instances under the given strategy,
 * optionally killing an instance partway through.
 *
 * - `sticky`   : a user is pinned to `hash(userId) % instanceCount`, and their cart lives in
 *                that instance's memory. Killing the instance destroys the cart.
 * - `stateless`: any instance serves any request, and the cart lives in the shared store.
 *                Killing an instance costs the in-flight request and nothing else.
 */
export function runFleet(opts: {
  strategy: Strategy;
  instanceCount: number;
  requests: Request[];
  /** Index of the instance to kill, or undefined to kill none. */
  killInstance?: number;
  /** Kill it after this many requests have been processed. */
  killAfter?: number;
}): FleetResult {
  const { strategy, instanceCount, requests } = opts;

  // Per-instance local memory. This is the thing that must not hold session state.
  const localMemory: Array<Map<string, Cart>> = Array.from(
    { length: instanceCount },
    () => new Map(),
  );
  // The shared session store. Redis in production; a Map here.
  const sharedStore = new Map<string, Cart>();

  const alive = Array.from({ length: instanceCount }, () => true);
  const load = new Array<number>(instanceCount).fill(0);

  let served = 0;
  let sessionsLost = 0;
  let routedToDeadInstance = 0;
  let roundRobin = 0;

  requests.forEach((req, i) => {
    if (opts.killInstance !== undefined && opts.killAfter === i) {
      alive[opts.killInstance] = false;
      // A sticky instance's memory dies with it. This is the Availability Trap: every user
      // pinned to that instance loses their cart at the same instant.
      localMemory[opts.killInstance] = new Map();
    }

    // ---- routing
    let target: number;
    if (strategy === 'sticky') {
      // Session affinity: the same user always lands on the same instance, alive or not.
      target = hash(req.userId) % instanceCount;
      if (!alive[target]) {
        routedToDeadInstance++;
        sessionsLost++;
        return;
      }
    } else {
      // Any healthy instance will do, because none of them knows anything about the user.
      let attempts = 0;
      do {
        target = roundRobin++ % instanceCount;
        attempts++;
      } while (!alive[target] && attempts <= instanceCount);
      if (!alive[target]) return; // whole fleet down
    }

    load[target] = (load[target] ?? 0) + (req.weight ?? 1);

    // ---- session lookup, from wherever this strategy keeps state
    const store = strategy === 'sticky' ? localMemory[target]! : sharedStore;
    const existing = store.get(req.userId);
    const cart: Cart = existing ?? { userId: req.userId, items: 0 };
    cart.items += 1;
    store.set(req.userId, cart);

    served++;
  });

  return { served, sessionsLost, loadPerInstance: load, routedToDeadInstance };
}

/** Deterministic string hash, so routing is reproducible across runs and machines. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The spread between the busiest and least busy instance, as a ratio.
 *
 * 1.0 is perfectly even. Sticky routing distributes by *user*, not by load, so a single power
 * user or bot pushes this arbitrarily high while the load balancer reports that it is doing
 * its job. That is the Hot Node problem: Server A at 100% CPU while Server B sits idle.
 */
export function loadImbalance(loadPerInstance: number[]): number {
  const max = Math.max(...loadPerInstance);
  const min = Math.min(...loadPerInstance);
  return min === 0 ? Infinity : max / min;
}
