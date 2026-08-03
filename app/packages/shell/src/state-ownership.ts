/**
 * The State Ownership Rule: every piece of state has exactly one owner.
 *
 * Chapter 5 is precise about the consequence. If multiple micro-apps need the same data, that
 * data is not "global". It is a shared service with its own lifecycle, its own fallback
 * behaviour, and its own blast radius. The word "global" is where the isolation is lost, because
 * global state has no owner, therefore no declared fallback, therefore no bounded failure.
 *
 * The registry refuses a second owner. That refusal is the value: it turns a design rule into an
 * error at the moment two teams would otherwise both reach for the same key, neither of them
 * wrong, and the coupling would be created by accident.
 */

export interface Owned {
  key: string;
  owner: string;
  /** What consumers see when the owner is unavailable. Required, per the rule. */
  fallback: unknown;
}

export class StateRegistry {
  private readonly owners = new Map<string, Owned>();

  claim(entry: Owned): this {
    const existing = this.owners.get(entry.key);
    if (existing && existing.owner !== entry.owner) {
      throw new Error(
        `state "${entry.key}" is already owned by ${existing.owner}; ` +
          `${entry.owner} must consume it as a shared service rather than co-owning it`,
      );
    }
    this.owners.set(entry.key, entry);
    return this;
  }

  ownerOf(key: string): string | undefined {
    return this.owners.get(key)?.owner;
  }

  /**
   * Read a value through its owner, degrading to the declared fallback when the owner throws.
   * A consumer never reads another micro-app's state directly, so this is the only path, which
   * is what makes the fallback reachable rather than theoretical.
   */
  read(key: string, fromOwner: () => unknown): { value: unknown; degraded: boolean } {
    const entry = this.owners.get(key);
    if (!entry) throw new Error(`no owner registered for state "${key}"`);
    try {
      return { value: fromOwner(), degraded: false };
    } catch {
      return { value: entry.fallback, degraded: true };
    }
  }
}
