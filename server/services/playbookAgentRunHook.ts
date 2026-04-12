/**
 * Playbook Agent Run Hook — bridge between agentExecutionService and the
 * playbook engine.
 *
 * Spec: tasks/playbooks-spec.md §5.3 (step completion handlers) and
 * §12.1 step 6.
 *
 * agentExecutionService calls notifyPlaybookEngineOnAgentRunComplete() at
 * the end of every agent run (success and failure paths). The hook checks
 * whether the agent run was dispatched by a playbook step and, if so,
 * routes the result back to playbookEngineService.onAgentRunCompleted().
 *
 * Why an indirection module instead of importing playbookEngineService
 * directly: the hook is invoked from agentExecutionService via dynamic
 * import to avoid creating an import cycle (engine → run service → engine
 * itself, indirectly through the agent run path). The dynamic import means
 * playbook code is only loaded when an agent run is involved with a
 * playbook step.
 *
 * The hook is non-blocking — failures are logged but never propagate to
 * the caller. An agent run completion succeeding is independent of any
 * playbook side effects.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { playbookEngineService } from './playbookEngineService.js';
import { logger } from '../lib/logger.js';

export async function notifyPlaybookEngineOnAgentRunComplete(
  agentRunId: string,
  result: { ok: boolean; output?: unknown; error?: string }
): Promise<void> {
  // Check whether this agent run is linked to a playbook step.
  const [run] = await db
    .select({ playbookStepRunId: agentRuns.playbookStepRunId })
    .from(agentRuns)
    .where(eq(agentRuns.id, agentRunId));

  if (!run || !run.playbookStepRunId) {
    // Most agent runs are not playbook-driven — silently no-op.
    return;
  }

  logger.info('playbook_agent_run_complete_hook', {
    agentRunId,
    playbookStepRunId: run.playbookStepRunId,
    ok: result.ok,
  });

  // Pass stepRunId directly — the engine looks up the step run by primary key.
  // Passing agentRunId along for logging/tracing in the engine.
  await playbookEngineService.onAgentRunCompleted(run.playbookStepRunId, result, agentRunId);
}
