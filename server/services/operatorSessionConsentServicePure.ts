/**
 * operatorSessionConsentServicePure.ts — Pure (no DB / no env) helpers for
 * operator session consent management.
 *
 * operator-session-identity chunk 2.
 *
 * Exports:
 *   - compareDisclosureVersion — determine whether a recorded acceptance is still
 *     valid against the current disclosure version number.
 */

// ---------------------------------------------------------------------------
// compareDisclosureVersion — spec §8
//
// When recorded < current the user has not accepted the latest version.
// recorded >= current means the recorded acceptance covers the current version.
// ---------------------------------------------------------------------------

export function compareDisclosureVersion(
  recorded: number,
  current: number,
): 'valid' | 'needs_reaccept' {
  return recorded < current ? 'needs_reaccept' : 'valid';
}
