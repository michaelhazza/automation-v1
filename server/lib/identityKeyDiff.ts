/**
 * Identity-key diff utility for full-replacement PUT endpoints.
 *
 * Compares an existing set of items with an incoming set, using a caller-supplied
 * key extractor to correlate items across the two sets.
 *
 * Semantics:
 * - added:          present in incoming, absent in existing (new rows to insert)
 * - updated:        present in both existing and incoming (rows to update)
 * - removed:        present in existing, absent in incoming AND force=true was applied by caller
 * - silentlyRemoved: present in existing, absent in incoming — triggers 409 unless force=true
 *
 * NOTE: The diff itself is force-agnostic. It always populates `silentlyRemoved`
 * with items that would be deleted. The caller (service layer) decides whether to
 * apply the deletion based on `options.force`.
 */

export interface DiffResult<T> {
  /** Items present in `incoming` but absent in `existing` — must be created. */
  added: T[];
  /** Items present in both `existing` and `incoming` — must be updated. */
  updated: T[];
  /** Items present in `existing` but absent in `incoming`.
   *  When the caller does not pass `force=true`, these are "silently removed"
   *  and should trigger a 409 IDENTITY_KEY_DELETION_BLOCKED response. */
  silentlyRemoved: T[];
}

/**
 * Produce an identity-key diff of two arrays.
 *
 * @param existing  Items currently in the database.
 * @param incoming  Items provided by the client for the full-replacement PUT.
 * @param getKey    Function that returns a stable string identity key for an item.
 */
export function diffByIdentityKey<T>(
  existing: T[],
  incoming: T[],
  getKey: (item: T) => string,
): DiffResult<T> {
  // Guard: duplicate incoming keys are a caller error — error fast rather than
  // silently processing one item twice (Q6 invariant).
  const incomingKeys = incoming.map(getKey);
  const uniqueIncomingKeys = new Set(incomingKeys);
  if (uniqueIncomingKeys.size !== incomingKeys.length) {
    const seen = new Set<string>();
    const dupes = incomingKeys.filter((k) => seen.has(k) || !seen.add(k));
    throw new Error(`diffByIdentityKey: duplicate incoming keys: ${[...new Set(dupes)].join(', ')}`);
  }

  const existingMap = new Map<string, T>();
  for (const item of existing) {
    existingMap.set(getKey(item), item);
  }

  const incomingMap = new Map<string, T>();
  for (const item of incoming) {
    incomingMap.set(getKey(item), item);
  }

  const added: T[] = [];
  const updated: T[] = [];
  const silentlyRemoved: T[] = [];

  for (const item of incoming) {
    const key = getKey(item);
    if (existingMap.has(key)) {
      updated.push(item);
    } else {
      added.push(item);
    }
  }

  for (const item of existing) {
    const key = getKey(item);
    if (!incomingMap.has(key)) {
      silentlyRemoved.push(item);
    }
  }

  return { added, updated, silentlyRemoved };
}
