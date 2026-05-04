/**
 * workflowRunInsertHelper — single chokepoint for INSERTs into `workflow_runs`.
 *
 * The partial unique index `workflow_runs_one_active_per_task_idx` (migration
 * 0276) guarantees at most one non-terminal run per task. When two callers
 * race the index fires SQLSTATE `23505`. Without this helper, every direct
 * `db.insert(workflowRuns)` site would surface that as a raw 5xx instead of
 * the typed `TaskAlreadyHasActiveRunError → 409` the API contract requires.
 *
 * Plan acceptance criterion P1-8 names "zero matches outside this helper".
 *
 * Lives in its own module to avoid the cycle workflowRunService ↔
 * workflowEngineService that would arise if it lived in workflowRunService.
 */

import type { db } from '../db/index.js';
import { workflowRuns } from '../db/schema/workflowRuns.js';
import { TaskAlreadyHasActiveRunError } from './errors/TaskAlreadyHasActiveRunError.js';

export async function insertRunRowWithUniqueGuard(
  tx: typeof db,
  values: typeof workflowRuns.$inferInsert,
  taskId: string,
): Promise<typeof workflowRuns.$inferSelect> {
  try {
    const [inserted] = await tx
      .insert(workflowRuns)
      .values(values)
      .returning();
    return inserted;
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505' &&
      'constraint' in err &&
      (err as { constraint: string }).constraint === 'workflow_runs_one_active_per_task_idx'
    ) {
      throw new TaskAlreadyHasActiveRunError(taskId);
    }
    throw err;
  }
}
