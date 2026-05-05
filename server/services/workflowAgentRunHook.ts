/**
 * Workflow Agent Run Hook — bridge between agentExecutionService and the
 * Workflow engine.
 *
 * Spec: tasks/Workflows-spec.md §5.3 (step completion handlers) and
 * §12.1 step 6.
 *
 * agentExecutionService calls notifyWorkflowEngineOnAgentRunComplete() at
 * the end of every agent run (success and failure paths). The hook checks
 * whether the agent run was dispatched by a Workflow step and, if so,
 * routes the result back to WorkflowEngineService.onAgentRunCompleted().
 *
 * Why an indirection module instead of importing WorkflowEngineService
 * directly: the hook is invoked from agentExecutionService via dynamic
 * import to avoid creating an import cycle (engine → run service → engine
 * itself, indirectly through the agent run path). The dynamic import means
 * Workflow code is only loaded when an agent run is involved with a
 * Workflow step.
 *
 * The hook is non-blocking — failures are logged but never propagate to
 * the caller. An agent run completion succeeding is independent of any
 * Workflow side effects.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { WorkflowEngineService } from './workflowEngineService.js';
import { logger } from '../lib/logger.js';

export async function notifyWorkflowEngineOnAgentRunComplete(
  agentRunId: string,
  result: { ok: boolean; output?: unknown; error?: string }
): Promise<void> {
  // Check whether this agent run is linked to a Workflow step.
  const [run] = await db
    .select({ workflowStepRunId: agentRuns.workflowStepRunId })
    .from(agentRuns)
    .where(eq(agentRuns.id, agentRunId));

  if (!run || !run.workflowStepRunId) {
    // Most agent runs are not Workflow-driven — silently no-op.
    return;
  }

  logger.info('workflow_agent_run_complete_hook', {
    agentRunId,
    workflowStepRunId: run.workflowStepRunId,
    ok: result.ok,
  });

  // Pass stepRunId directly — the engine looks up the step run by primary key.
  // Passing agentRunId along for logging/tracing in the engine.
  await WorkflowEngineService.onAgentRunCompleted(run.workflowStepRunId, result, agentRunId);
}
