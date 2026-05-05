/**
 * scopeResolutionPure.ts — pure helpers for scope resolution with no DB or env dependencies.
 *
 * Exported separately so tests can import these without pulling in the DB/env chain.
 */

/** Pure predicate for the entity-search guard. Exported so tests pin the boundary without spinning up the service. */
export function shouldSearchEntityHint(hint: string): boolean {
  return hint.trim().length >= 2;
}
