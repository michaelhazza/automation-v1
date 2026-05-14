import { db } from '../db/index.js';
import { workflowRuns } from '../db/schema/workflowRuns.js';
import type { WorkflowRunStatus } from '../db/schema/workflowRuns.js';
import { and, eq, notInArray } from 'drizzle-orm';
import { WORKFLOW_RUN_TERMINAL_STATUSES } from '../../shared/types/workflowRunStatus.js';

const TERMINAL_STATUSES = [...WORKFLOW_RUN_TERMINAL_STATUSES] as WorkflowRunStatus[];

/**
 * Resolves the active (non-terminal) run for a task.
 * Returns the runId if found, null otherwise.
 * Uses the DB-enforced partial-unique index so at most one row is returned.
 */
export async function resolveActiveRunForTask(
  taskId: string,
  organisationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.taskId, taskId),
        eq(workflowRuns.organisationId, organisationId),
        notInArray(workflowRuns.status, TERMINAL_STATUSES),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
