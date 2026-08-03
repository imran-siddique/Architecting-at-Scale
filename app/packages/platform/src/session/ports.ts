/**
 * The shared session store port.
 *
 * Deliberately its own minimal interface rather than reusing Chapter 9's `CacheStore`. A session
 * store and a cache are the same technology (Redis) doing different jobs: a cache entry may be
 * evicted at any time and the origin is the source of truth, whereas the session store IS the
 * source of truth for the session. Sharing one interface would blur that, and would make
 * Chapter 2 depend on a package Chapter 9 introduces.
 */
export interface SessionBackend {
  get(key: string): Promise<string | null>;
  /** TTL is required. A session that never expires is an authentication bug with a long fuse. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<number>;
}
