/**
 * Key construction, in one place.
 *
 * Chapter 9's Tool Tax on Redis is the field-name contract the store does not enforce: Redis
 * will happily accept `product:123`, `products:123` and `catalog:product:123` as three
 * unrelated keys, and you find out during an incident. Every key in the system is built here
 * so the contract lives in code rather than in convention.
 */

const SEP = ':';
const NAMESPACE = 'sf'; // shopflow

/** The cached representation of one entity: sf:<keyspace>:<id> */
export function entityKey(keyspace: string, id: string): string {
  return [NAMESPACE, keyspace, id].join(SEP);
}

/** The distributed herd lock guarding one entity read. */
export function herdLockKey(entity: string): string {
  return `${entity}${SEP}lock`;
}

/**
 * The dedupe marker for one delivery of one invalidation event.
 * Keyed on the event id, not on the entity, because at-least-once means the same event can
 * arrive twice while two different events for the same entity must both be processed.
 */
export function dedupeKey(eventId: string): string {
  return [NAMESPACE, 'dedupe', eventId].join(SEP);
}

/** The public URL paths the CDN caches for an entity, used when purging the edge. */
export function edgePathsForProduct(productId: string): string[] {
  return [`/api/catalog/products/${productId}`, `/p/${productId}`];
}
