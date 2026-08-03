import type { SessionBackend } from './ports.js';

/**
 * Externalized session state.
 *
 * Chapter 2's Golden Rule: a horizontally scalable service treats every incoming request as a
 * stranger. It should never rely on memory of a previous conversation to understand the current
 * one. Stated as mechanics rather than metaphor: every instance is stateless, and all state
 * lives in an external store.
 *
 * The lookup is the whole thing, read the session by ID, reuse it if present, create and write
 * it back only if absent. No instance ever holds the authoritative copy, so no instance is
 * special, so any instance can be lost.
 */
export interface Session {
  id: string;
  userId: string | null;
  cart: Record<string, number>;
  createdAt: number;
}

const PREFIX = 'sf:session:';

export class SessionStore {
  constructor(
    private readonly backend: SessionBackend,
    private readonly ttlSeconds: number = 60 * 60 * 24 * 7,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Read the session for `id`, or create one. This single call is what replaces every
   * `req.session` read against instance memory.
   */
  async readOrCreate(id: string): Promise<Session> {
    const raw = await this.backend.get(PREFIX + id);
    if (raw !== null) {
      return JSON.parse(raw) as Session;
    }
    const fresh: Session = { id, userId: null, cart: {}, createdAt: this.now() };
    await this.backend.set(PREFIX + id, JSON.stringify(fresh), this.ttlSeconds);
    return fresh;
  }

  /** Persist a mutated session. Refreshes the TTL, so an active session does not expire mid-visit. */
  async save(session: Session): Promise<void> {
    await this.backend.set(PREFIX + session.id, JSON.stringify(session), this.ttlSeconds);
  }

  /** Log out. Deleting server-side is the point: a discarded cookie is not a terminated session. */
  async destroy(id: string): Promise<void> {
    await this.backend.del(PREFIX + id);
  }
}
