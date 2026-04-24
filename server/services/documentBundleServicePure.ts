import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// documentBundleServicePure — pure helpers for documentBundleService
//
// computeDocSetHash: canonical hash for a document set. Used by:
//   - findOrCreateUnnamedBundle (identity lookup)
//   - suggestBundle (suggestion matching)
//   - dismissBundleSuggestion (dismissal storage key)
// ---------------------------------------------------------------------------

/**
 * Canonical doc-set hash. Sorts document IDs ascending, then SHA-256 hashes
 * the newline-joined sequence. Order-independent: the same set in any order
 * produces the same hash.
 *
 * This is intentionally engine-version-agnostic — it does NOT include
 * model_family or assembly_version. Dismissals and unnamed-bundle identity
 * must survive assembly_version bumps without invalidation.
 */
export function computeDocSetHash(documentIds: string[]): string {
  const sorted = [...documentIds].sort();
  return createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
}
