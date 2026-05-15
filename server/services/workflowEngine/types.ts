export type { WorkflowRun, WorkflowStepRun } from '../../db/schema/index.js';
export type { WorkflowRunMode } from '../../db/schema/workflowRuns.js';
export type {
  WorkflowDefinition,
  WorkflowStep,
  RunContext,
  AgentDecisionStep,
  ActionCallStep,
  InvokeAutomationStep,
} from '../../lib/workflow/types.js';

import type { WorkflowRun } from '../../db/schema/index.js';

/**
 * Narrows run.subaccountId to string for subaccount-scoped operations.
 * Throws on null — defends against programming errors where a caller
 * accidentally routes an org-scope run through a subaccount-only path.
 */
export function requireSubaccountId(run: WorkflowRun): string {
  if (run.subaccountId === null) {
    throw new Error(
      `Workflow run ${run.id} has scope='${run.scope}' with no subaccount_id; ` +
      `callsite expected a subaccount-scope run`,
    );
  }
  return run.subaccountId;
}
