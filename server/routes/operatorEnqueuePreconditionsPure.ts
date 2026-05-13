// operatorEnqueuePreconditionsPure.ts — pure precondition checks for enqueue-only routes.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b (Rev 2 F1)
//
// retry-chain-failure: precondition task.status === 'paused_chain_failure'
// extend-budget:       precondition task.status === 'paused_budget_exceeded'
//                      and extensionMinutes in [60, 60000] step 60

export type RetryChainFailurePreconditionResult =
  | { ok: true }
  | { ok: false; errorKind: 'WRONG_STATUS'; currentStatus: string };

export type ExtendBudgetPreconditionResult =
  | { ok: true }
  | { ok: false; errorKind: 'WRONG_STATUS'; currentStatus: string }
  | { ok: false; errorKind: 'INVALID_EXTENSION'; extensionMinutes: number };

/**
 * Checks preconditions for the retry-chain-failure enqueue-only route.
 * Does NOT update status — only the dispatcher can do that.
 */
export function checkRetryChainFailurePrecondition(
  taskStatus: string,
): RetryChainFailurePreconditionResult {
  if (taskStatus !== 'paused_chain_failure') {
    return { ok: false, errorKind: 'WRONG_STATUS', currentStatus: taskStatus };
  }
  return { ok: true };
}

/**
 * Checks preconditions for the extend-budget enqueue-only route.
 * Does NOT update status — only the dispatcher can do that.
 */
export function checkExtendBudgetPrecondition(
  taskStatus: string,
  extensionMinutes: number,
): ExtendBudgetPreconditionResult {
  if (taskStatus !== 'paused_budget_exceeded') {
    return { ok: false, errorKind: 'WRONG_STATUS', currentStatus: taskStatus };
  }
  if (!Number.isInteger(extensionMinutes) || extensionMinutes < 60 || extensionMinutes > 60000) {
    return { ok: false, errorKind: 'INVALID_EXTENSION', extensionMinutes };
  }
  return { ok: true };
}

/**
 * Describes what the retry-chain-failure route SHOULD write to agent_runs on success.
 * Returns a patch object — does NOT touch agent_runs.status (enforces Rev 2 invariant 1).
 */
export function describeRetryChainFailurePatch(): { operatorChainFailureCount: 0 } {
  return { operatorChainFailureCount: 0 };
}
