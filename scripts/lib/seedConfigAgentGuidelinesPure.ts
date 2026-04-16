/**
 * Pure decision logic for the Configuration Assistant guidelines seeder.
 * No DB imports — safe to import in tests without a database connection.
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.4
 */

export type SeederDecision =
  | { kind: 'create' }
  | { kind: 'reattach' }
  | { kind: 'noop' }
  | { kind: 'warn_divergence' };

/**
 * Decide what the seeder should do for a given org based on the current state.
 *
 * Priority order:
 *   1. No block exists → create (+ attach)
 *   2. Block exists but not attached → reattach (regardless of content)
 *   3. Block exists, attached, content differs → warn (preserve runtime edit)
 *   4. Block exists, attached, content matches → noop
 */
export function decideSeederAction(opts: {
  blockExists: boolean;
  attachmentExists: boolean;
  contentMatches: boolean;
}): SeederDecision {
  if (!opts.blockExists) return { kind: 'create' };
  if (!opts.attachmentExists) return { kind: 'reattach' };
  if (!opts.contentMatches) return { kind: 'warn_divergence' };
  return { kind: 'noop' };
}
