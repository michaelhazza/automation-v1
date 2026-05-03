/**
 * workflowRunStartSkillServicePure.ts — pure pre-condition checks for the
 * workflow.run.start skill.
 *
 * Spec: docs/workflows-dev-spec.md §13 (workflow.run.start skill)
 * No I/O — safe to unit-test without any mocks.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type WorkflowRunStartErrorCode =
  | 'permission_denied'
  | 'template_not_found'
  | 'template_not_published'
  | 'inputs_invalid';

export type WorkflowRunStartOutput =
  | { ok: true; task_id: string; run_id: string }
  | { ok: false; error: WorkflowRunStartErrorCode; message: string };

export type WorkflowRunStartPreconditionResult =
  | { ok: 'proceed' }
  | WorkflowRunStartOutput;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Decide the outcome of a workflow.run.start skill call based on the
 * pre-condition flags resolved by the caller.
 *
 * Evaluated in priority order:
 *   1. Template existence + org ownership
 *   2. Caller permission
 *   3. Published version available
 *   4. Input validity
 *
 * Returns `{ ok: 'proceed' }` when all checks pass — the caller then executes
 * the actual run creation.
 */
export function decideWorkflowRunStartOutcome(input: {
  templateExists: boolean;
  templateOrgMatch: boolean;
  versionResolved: boolean;
  callerHasPermission: boolean;
  inputsValid: boolean;
}): WorkflowRunStartPreconditionResult {
  // 1. Template must exist and belong to the caller's org.
  if (!input.templateExists || !input.templateOrgMatch) {
    return {
      ok: false,
      error: 'template_not_found',
      message: 'Workflow template not found or does not belong to your organisation.',
    };
  }

  // 2. Permission check before revealing further state.
  if (!input.callerHasPermission) {
    return {
      ok: false,
      error: 'permission_denied',
      message: 'You do not have permission to start workflow runs on this subaccount.',
    };
  }

  // 3. A published version must be available.
  if (!input.versionResolved) {
    return {
      ok: false,
      error: 'template_not_published',
      message: 'This workflow template has no published version. Publish a version before starting a run.',
    };
  }

  // 4. Input validation.
  if (!input.inputsValid) {
    return {
      ok: false,
      error: 'inputs_invalid',
      message: 'The provided initial_inputs do not satisfy the template input schema.',
    };
  }

  return { ok: 'proceed' };
}
