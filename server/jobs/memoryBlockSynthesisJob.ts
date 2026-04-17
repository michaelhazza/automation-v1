/**
 * memoryBlockSynthesisJob — weekly per-subaccount auto-synthesis (§5.7 S11)
 *
 * Iterates every active subaccount and invokes
 * memoryBlockSynthesisService.runSynthesisForSubaccount. Individual failures
 * are logged but don't abort the sweep.
 *
 * Scheduled via pg-boss at `maintenance:memory-block-synthesis`.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { runSynthesisForSubaccount } from '../services/memoryBlockSynthesisService.js';
import { logger } from '../lib/logger.js';

export interface MemoryBlockSynthesisSweepSummary {
  subaccountsProcessed: number;
  blocksAutoActivated: number;
  blocksQueuedForReview: number;
  blocksPassiveAged: number;
  failed: number;
  durationMs: number;
}

export async function runMemoryBlockSynthesisSweep(): Promise<MemoryBlockSynthesisSweepSummary> {
  const started = Date.now();
  let subaccountsProcessed = 0;
  let blocksAutoActivated = 0;
  let blocksQueuedForReview = 0;
  let blocksPassiveAged = 0;
  let failed = 0;

  const rows = (await db.execute(sql`
    SELECT id, organisation_id FROM subaccounts
    WHERE deleted_at IS NULL AND status = 'active'
    ORDER BY id
  `)) as unknown as
    | Array<{ id: string; organisation_id: string }>
    | { rows?: Array<{ id: string; organisation_id: string }> };

  const list = Array.isArray(rows) ? rows : rows.rows ?? [];

  for (const row of list) {
    try {
      const summary = await runSynthesisForSubaccount(row.id, row.organisation_id);
      subaccountsProcessed += 1;
      blocksAutoActivated += summary.blocksAutoActivated;
      blocksQueuedForReview += summary.blocksQueuedForReview;
      blocksPassiveAged += summary.blocksPassiveAged;
    } catch (err) {
      failed += 1;
      logger.error('memoryBlockSynthesisJob.subaccount_failed', {
        subaccountId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: MemoryBlockSynthesisSweepSummary = {
    subaccountsProcessed,
    blocksAutoActivated,
    blocksQueuedForReview,
    blocksPassiveAged,
    failed,
    durationMs: Date.now() - started,
  };

  logger.info('memoryBlockSynthesisJob.tick_complete', { ...summary });
  return summary;
}
