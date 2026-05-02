/**
 * workflowRunCostLedgerService.ts — cost attribution for workflow runs.
 *
 * Decision 12 (spec §5.7): `workflow_runs.cost_accumulator_cents` is the
 * control-flow source of truth for cap checks. Every cost write MUST increment
 * the accumulator in the same transaction so cap checks read a point-in-time
 * consistent value.
 *
 * The `workflow_run_cost_ledger` audit table is planned but not yet created
 * in the Chunk 1 migration. This service currently performs only the
 * accumulator increment. When the ledger table is created (future migration),
 * the INSERT will be added here alongside the accumulator UPDATE — both
 * in the same transaction, atomically.
 *
 * CALLERS: always pass the owning transaction (`tx`). Never call this outside
 * a transaction — the two writes (INSERT + UPDATE) must be atomic.
 */

import { eq, sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';
import { workflowRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

/**
 * Record a cost delta for a workflow run.
 *
 * Atomically:
 *   1. Increments `workflow_runs.cost_accumulator_cents` by `delta`.
 *   2. (Future) Inserts a row into `workflow_run_cost_ledger` for audit.
 *
 * @param runId      The workflow run ID.
 * @param delta      Cost in cents (must be non-negative).
 * @param description Human-readable label (e.g. 'agent_call:step-1').
 * @param tx         The owning transaction — callers always provide this.
 */
export async function writeCostLedgerRow(
  runId: string,
  delta: number,
  description: string,
  tx: OrgScopedTx
): Promise<void> {
  if (delta <= 0) return; // zero / negative deltas are no-ops

  // Increment the control-flow accumulator.
  await tx
    .update(workflowRuns)
    .set({
      costAccumulatorCents: sql`${workflowRuns.costAccumulatorCents} + ${delta}`,
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, runId));

  logger.debug('workflow_cost_accumulator_incremented', {
    event: 'cost.accumulator_incremented',
    runId,
    deltaCents: delta,
    description,
  });

  // TODO (future migration): INSERT INTO workflow_run_cost_ledger
  //   (run_id, delta_cents, description, created_at)
  //   VALUES ($runId, $delta, $description, NOW())
  // This INSERT must go in the same transaction as the UPDATE above.
}
