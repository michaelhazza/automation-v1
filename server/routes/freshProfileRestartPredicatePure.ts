// freshProfileRestartPredicatePure.ts — pure precondition check for fresh-profile-restart.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15 item 7, §6.5b (Rev 2 F6)
//
// Preconditions (both must pass in one atomic FOR UPDATE read):
//   (a) task.status === 'paused_chain_failure'
//   (b) latest non-superseded chain-link row has failure_class === 'profile_corruption'
//       OR failure_reason === 'OPERATOR_PROFILE_UNRECOVERABLE'

export type FreshProfileRestartBlockingReason =
  | 'TASK_NOT_PAUSED_CHAIN_FAILURE'
  | 'LATEST_FAILURE_NOT_PROFILE_CORRUPTION';

export interface FreshProfileRestartPredicateInput {
  taskStatus: string;
  latestChainLinkFailureClass: string | null;
  latestChainLinkFailureReason: string | null;
}

export interface FreshProfileRestartPredicateResult {
  allowed: boolean;
  blockingReason?: FreshProfileRestartBlockingReason;
}

/**
 * Determines whether a fresh-profile restart is permitted for the given task state.
 *
 * Returns allowed=true when:
 *   - task status is 'paused_chain_failure', AND
 *   - the latest non-superseded chain-link's failure_class is 'profile_corruption'
 *     OR its failure_reason is 'OPERATOR_PROFILE_UNRECOVERABLE'
 *
 * Returns allowed=false with a specific blockingReason otherwise.
 */
export function decideFreshProfileRestartAllowed(
  input: FreshProfileRestartPredicateInput,
): FreshProfileRestartPredicateResult {
  if (input.taskStatus !== 'paused_chain_failure') {
    return {
      allowed: false,
      blockingReason: 'TASK_NOT_PAUSED_CHAIN_FAILURE',
    };
  }

  const isProfileCorruption =
    input.latestChainLinkFailureClass === 'profile_corruption' ||
    input.latestChainLinkFailureReason === 'OPERATOR_PROFILE_UNRECOVERABLE';

  if (!isProfileCorruption) {
    return {
      allowed: false,
      blockingReason: 'LATEST_FAILURE_NOT_PROFILE_CORRUPTION',
    };
  }

  return { allowed: true };
}
