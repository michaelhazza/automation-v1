import type { HierarchyContext } from '../../shared/types/delegation.js';

// ---------------------------------------------------------------------------
// Derived skill slugs — granted by graph position, not explicit attachment.
// Any agent with at least one direct report receives these three delegation
// skills automatically at resolve time.
// ---------------------------------------------------------------------------

const DERIVED_DELEGATION_SLUGS = [
  'config_list_agents',
  'spawn_sub_agents',
  'reassign_task',
] as const;

/**
 * Compute the set of skill slugs that should be granted to an agent based
 * purely on its position in the hierarchy graph.
 *
 * Pure function: no DB access, no side effects.
 *
 * @param input.hierarchy - The agent's resolved HierarchyContext, or undefined
 *   if hierarchy could not be built (e.g. non-subaccount run, or build failure).
 * @returns Array of derived slug strings (may be empty).
 */
export function computeDerivedSkills(input: {
  hierarchy: Readonly<HierarchyContext> | undefined;
}): string[] {
  if ((input.hierarchy?.childIds.length ?? 0) > 0) {
    return [...DERIVED_DELEGATION_SLUGS];
  }
  return [];
}

/**
 * Returns true when the hierarchy resolver should emit a WARN.
 * Fires when the caller is in a subaccount context (hierarchy was expected)
 * but the hierarchy snapshot could not be built.
 */
export function shouldWarnMissingHierarchy(input: {
  hierarchy: Readonly<HierarchyContext> | undefined;
  subaccountId: string | undefined;
}): boolean {
  return input.hierarchy === undefined && input.subaccountId !== undefined;
}
