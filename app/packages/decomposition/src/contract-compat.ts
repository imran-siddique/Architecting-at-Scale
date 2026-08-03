/**
 * The Silent Breaking Change Rule.
 *
 * Chapter 6: "A change is breaking if any consumer's behavior changes as a result, regardless of
 * whether the schema changed. Additive changes break strict deserializers. Behavioral changes
 * break consumers that assumed invariants the contract never formalized. Both require a version
 * increment."
 *
 * That second sentence is the one worth encoding, because it contradicts the usual shortcut.
 * "Additive changes are safe" is true only against tolerant readers, and a strict deserializer,
 * which is the default in several languages, rejects an unknown field outright. So this checker
 * takes the consumer's tolerance as an input rather than assuming it.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  /**
   * An invariant the consumer may be relying on even though the schema does not express it, for
   * example "always non-negative" or "always sorted by created_at descending". Changing one of
   * these is the behavioural break the rule is aimed at.
   */
  invariant?: string;
}

export interface Contract {
  version: string;
  fields: FieldSpec[];
}

export type ConsumerTolerance = 'tolerant' | 'strict';

export type BreakKind =
  | 'field-removed'
  | 'field-type-changed'
  | 'optional-became-required'
  | 'invariant-changed'
  | 'field-added-strict-consumer';

export interface Break {
  kind: BreakKind;
  field: string;
  detail: string;
}

export interface CompatResult {
  breaking: boolean;
  breaks: Break[];
  /** Changes that are safe for every consumer. */
  safe: string[];
  /** True when the version was incremented as the rule requires. */
  versionIncremented: boolean;
  /** The finding that matters: breaking, and shipped without a version bump. */
  requiresVersionBump: boolean;
}

/**
 * Compare two contracts for a consumer of a given tolerance.
 *
 * `tolerance` defaults to `strict`, deliberately. Assuming tolerant readers is how additive
 * changes get shipped as non-breaking and then break somebody, and the conservative default is
 * the one that fails a CI check rather than a customer.
 */
export function checkCompatibility(
  before: Contract,
  after: Contract,
  tolerance: ConsumerTolerance = 'strict',
): CompatResult {
  const breaks: Break[] = [];
  const safe: string[] = [];
  const beforeByName = new Map(before.fields.map((f) => [f.name, f]));
  const afterByName = new Map(after.fields.map((f) => [f.name, f]));

  for (const [name, was] of beforeByName) {
    const now = afterByName.get(name);
    if (!now) {
      breaks.push({ kind: 'field-removed', field: name, detail: 'consumers reading it get nothing' });
      continue;
    }
    if (now.type !== was.type) {
      breaks.push({
        kind: 'field-type-changed',
        field: name,
        detail: `${was.type} became ${now.type}`,
      });
    }
    if (!was.required && now.required) {
      breaks.push({
        kind: 'optional-became-required',
        field: name,
        detail: 'producers that omitted it now fail validation',
      });
    }
    // The silent one. Nothing in the schema changed.
    if (was.invariant !== now.invariant) {
      breaks.push({
        kind: 'invariant-changed',
        field: name,
        detail: `invariant "${was.invariant ?? 'none'}" became "${now.invariant ?? 'none'}"; ` +
          `the schema is identical and consumers relying on the old guarantee will break`,
      });
    }
  }

  for (const [name, added] of afterByName) {
    if (beforeByName.has(name)) continue;
    if (tolerance === 'strict') {
      breaks.push({
        kind: 'field-added-strict-consumer',
        field: name,
        detail: 'a strict deserializer rejects an unknown field, so this addition is breaking',
      });
    } else {
      safe.push(`added optional field ${name}`);
    }
    if (added.required && tolerance === 'tolerant') {
      // A required addition is breaking even for a tolerant reader, because the producer side
      // must now supply it.
      breaks.push({
        kind: 'optional-became-required',
        field: name,
        detail: 'a newly required field must be supplied by every producer',
      });
    }
  }

  const versionIncremented = before.version !== after.version;
  const breaking = breaks.length > 0;

  return {
    breaking,
    breaks,
    safe,
    versionIncremented,
    requiresVersionBump: breaking && !versionIncremented,
  };
}
