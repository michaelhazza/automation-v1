// ---------------------------------------------------------------------------
// stepLifecyclePure.ts
//
// Pure helpers extracted from stepLifecycle.ts.
//
// The buildFailStepRunColumnSet helper is the single source of truth for the
// column set written when failing a workflow_step_run. It is consumed by:
//   1. failStepRunInternal (stepLifecycle.ts) — the normal in-process path
//   2. expireWaitpoints approval-kind cleanup (waitpointService.ts) — the
//      admin-role sweep path
//
// Extracting it here closes the drift class: adding a column to
// failStepRunInternal without updating this helper will fail the column-parity
// test in stepLifecyclePure.test.ts.
//
// Spec: docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md §5.3 F5
// ---------------------------------------------------------------------------

export interface FailStepRunColumns {
  status: 'failed';
  error: string;
  completedAt: Date;
  version: number;
  updatedAt: Date;
}

/**
 * Builds the column-value map used when transitioning a workflow_step_run to
 * the 'failed' terminal state. Pure function — no DB I/O.
 *
 * @param reason         - The failure reason string (stored in the error column).
 * @param currentVersion - The step run's current version; result is version + 1.
 * @param now            - Timestamp for completedAt and updatedAt.
 */
export function buildFailStepRunColumnSet(
  reason: string,
  currentVersion: number,
  now: Date,
): FailStepRunColumns {
  return {
    status: 'failed',
    error: reason,
    completedAt: now,
    version: currentVersion + 1,
    updatedAt: now,
  };
}
