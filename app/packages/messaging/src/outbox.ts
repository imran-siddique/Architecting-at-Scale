/**
 * The Transactional Outbox.
 *
 * The gap it closes is narrow and permanent: write the order, then publish the event. If the
 * process dies between those two steps, the order exists and the event does not, forever. No amount
 * of consumer retry logic helps, because nothing was ever published. Inventory is never reserved,
 * the confirmation email is never sent, and the only evidence is a customer complaint.
 *
 * The outbox makes the event part of the same transaction as the domain write, so the two commit
 * or fail together. A separate relay then publishes from the table, and because the relay can
 * crash after publishing but before marking the row sent, delivery is at-least-once. That is not a
 * flaw in the pattern; it is the reason every consumer in this book needs an idempotency key.
 */

export interface OutboxEvent {
  eventId: string;
  topic: string;
  payload: Record<string, unknown>;
  /** Set when the relay has published it AND the broker acknowledged. */
  publishedAt?: number;
  attempts: number;
}

/**
 * A minimal transactional store, so the atomicity guarantee can be demonstrated rather than
 * asserted. `transaction` either commits every write or none of them.
 */
export class TransactionalStore {
  private readonly rows = new Map<string, unknown>();
  private readonly outbox: OutboxEvent[] = [];

  /**
   * Run `work` atomically. If it throws, every write inside it is discarded, including the
   * outbox row. That coupling is the whole pattern.
   */
  async transaction<T>(
    work: (tx: {
      write: (key: string, value: unknown) => void;
      enqueue: (event: Omit<OutboxEvent, 'attempts' | 'publishedAt'>) => void;
    }) => Promise<T> | T,
  ): Promise<T> {
    const stagedRows: Array<[string, unknown]> = [];
    const stagedEvents: OutboxEvent[] = [];

    const result = await work({
      write: (key, value) => stagedRows.push([key, value]),
      enqueue: (e) => stagedEvents.push({ ...e, attempts: 0 }),
    });

    // Commit point. Reached only if `work` did not throw.
    for (const [k, v] of stagedRows) this.rows.set(k, v);
    this.outbox.push(...stagedEvents);
    return result;
  }

  get(key: string): unknown {
    return this.rows.get(key);
  }

  /** Unpublished events, oldest first. What the relay polls for. */
  pending(): OutboxEvent[] {
    return this.outbox.filter((e) => e.publishedAt === undefined);
  }

  all(): readonly OutboxEvent[] {
    return this.outbox;
  }

  markPublished(eventId: string, at: number): void {
    const e = this.outbox.find((x) => x.eventId === eventId);
    if (e) e.publishedAt = at;
  }

  recordAttempt(eventId: string): void {
    const e = this.outbox.find((x) => x.eventId === eventId);
    if (e) e.attempts++;
  }

  /** Bound table growth. An unbounded outbox becomes the slowest table in the database. */
  prunePublished(before: number): number {
    let removed = 0;
    for (let i = this.outbox.length - 1; i >= 0; i--) {
      const e = this.outbox[i]!;
      if (e.publishedAt !== undefined && e.publishedAt < before) {
        this.outbox.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}

export interface Broker {
  /** Resolves only once the broker has acknowledged. Throwing means not delivered. */
  publish(topic: string, payload: Record<string, unknown>, eventId: string): Promise<void>;
}

export interface RelayResult {
  published: string[];
  failed: string[];
}

/**
 * The relay.
 *
 * `markPublished` is gated on the broker's acknowledgement, never on the send returning. Marking
 * first would convert an at-least-once pipeline into an at-most-once one, and losing an event is
 * the failure the outbox exists to prevent. Erring toward duplicates is the correct direction,
 * because duplicates are what the consumers are already built for.
 */
export async function relayOnce(
  store: TransactionalStore,
  broker: Broker,
  now: () => number = Date.now,
): Promise<RelayResult> {
  const published: string[] = [];
  const failed: string[] = [];

  for (const event of store.pending()) {
    store.recordAttempt(event.eventId);
    try {
      await broker.publish(event.topic, event.payload, event.eventId);
      store.markPublished(event.eventId, now());
      published.push(event.eventId);
    } catch {
      // Left pending deliberately. The next poll retries it, and the consumer deduplicates.
      failed.push(event.eventId);
    }
  }

  return { published, failed };
}

/**
 * The Polling Frequency Rule.
 *
 * "The outbox polling interval must be derived from the downstream event delivery SLO, not from a
 * framework default. If the consumer's maximum acceptable processing delay is 500ms, the polling
 * interval must be under 250ms."
 *
 * The ratio is the point: the interval has to leave room for the publish and the consume, so half
 * the SLO is the ceiling rather than the target.
 */
export function maxPollIntervalMs(deliverySloMs: number): number {
  if (deliverySloMs <= 0) throw new RangeError('delivery SLO must be positive');
  return deliverySloMs / 2;
}

export function validatePollInterval(
  pollIntervalMs: number,
  deliverySloMs: number,
): { ok: boolean; ceiling: number; reason?: string } {
  const ceiling = maxPollIntervalMs(deliverySloMs);
  if (pollIntervalMs > ceiling) {
    return {
      ok: false,
      ceiling,
      reason:
        `a ${pollIntervalMs}ms poll interval cannot meet a ${deliverySloMs}ms delivery SLO: ` +
        `polling alone consumes the budget before the publish and consume are counted`,
    };
  }
  return { ok: true, ceiling };
}
