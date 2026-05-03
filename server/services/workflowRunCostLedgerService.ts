import { db } from '../db/index.js';
import { workflowRuns } from '../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

type TxOrDb = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const WorkflowRunCostLedgerService = {
  /**
   * Atomically increment cost_accumulator_cents on the workflow run.
   * Call inside the same transaction that writes the cost ledger row.
   * Spec §7 / Decision 12: cost_accumulator_cents is the control-flow
   * source of truth for cap checks; the audit ledger is separate.
   */
  async incrementAccumulator(
    workflowRunId: string,
    deltaCents: number,
    txOrDb: TxOrDb = db,
  ): Promise<void> {
    if (deltaCents <= 0) return;
    await (txOrDb as typeof db)
      .update(workflowRuns)
      .set({
        costAccumulatorCents: sql`${workflowRuns.costAccumulatorCents} + ${deltaCents}`,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, workflowRunId));
    logger.debug('workflow_run_cost_accumulator_incremented', {
      workflowRunId,
      deltaCents,
    });
  },
};
