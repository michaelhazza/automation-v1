/**
 * runOptimiserScanJob (queue: optimiser-scan)
 *
 * Thin pg-boss job handler that runs the full 8-category optimiser scan for a
 * single subaccount. Org context (ALS + db.transaction + withOrgTx) is provided
 * by createWorker, satisfying the ALS invariant that runOptimiserScan relies on
 * for getOrgScopedDb().
 *
 * Idempotency: 'fifo' — the scan re-reads current DB state each tick, so a
 * duplicate delivery re-runs the scan harmlessly (recommendations are deduped
 * by evidence hash inside runOptimiserScan).
 *
 * Failure mode: errors propagate to pg-boss for retry per jobConfig. After
 * exhaustion the job lands in optimiser-scan__dlq and the dlq-not-drained
 * synthetic check fires.
 */

import type PgBoss from 'pg-boss';
import { runOptimiserScan } from '../services/optimiser/runOptimiserScan.js';
import { logger } from '../lib/logger.js';

export interface OptimiserScanPayload {
  subaccountId: string;
  organisationId: string;
  agentId: string;
  subaccountAgentId: string;
}

export async function handleOptimiserScan(job: PgBoss.Job<OptimiserScanPayload>): Promise<void> {
  const { subaccountId, organisationId, agentId } = job.data;

  try {
    const summary = await runOptimiserScan(subaccountId, organisationId, agentId);
    logger.info('optimiser.scan.job.completed', {
      subaccountId,
      candidatesProduced: summary.candidatesProduced,
      candidatesDeduped: summary.candidatesDeduped,
      failedCategories: summary.failedCategories,
      partialMode: summary.partialMode,
      durationMs: summary.durationMs,
    });
  } catch (err) {
    logger.error('optimiser.scan.job.failed', {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err; // re-throw so pg-boss marks the job failed and retries
  }
}
