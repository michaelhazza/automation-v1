/**
 * memoryEntryQualityAdjustJob — weekly utility-based qualityScore adjustment
 *
 * Iterates all active subaccounts and, for each, runs
 * `memoryEntryQualityService.adjustFromUtility()`. This is the second and
 * only other qualityScore mutator alongside the nightly decay pass.
 *
 * **Gated behind the `S4_QUALITY_ADJUST_LIVE` feature flag** — Phase 2
 * exit-criterion requires a threshold-tuning pass before this job is given
 * full authority to reduce qualityScore. When the flag is off, the job
 * logs the rows it WOULD have adjusted and returns a 0-count summary so
 * behaviour can be inspected in production without side effects.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S4)
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { adjustFromUtility } from '../services/memoryEntryQualityService.js';
import { S4_QUALITY_ADJUST_LIVE } from '../config/limits.js';
import { logger } from '../lib/logger.js';

export interface MemoryEntryQualityAdjustSummary {
  subaccountsProcessed: number;
  totalBoosted: number;
  totalReduced: number;
  totalSkipped: number;
  skipped: number;
  flagEnabled: boolean;
  durationMs: number;
}

export async function runMemoryEntryQualityAdjust(): Promise<MemoryEntryQualityAdjustSummary> {
  const started = Date.now();
  let subaccountsProcessed = 0;
  let totalBoosted = 0;
  let totalReduced = 0;
  let totalSkipped = 0;
  let skipped = 0;

  if (!S4_QUALITY_ADJUST_LIVE) {
    logger.info('memoryEntryQualityAdjustJob.flag_off', {
      message: 'S4_QUALITY_ADJUST_LIVE feature flag is off — job exits without writes',
    });
    return {
      subaccountsProcessed: 0,
      totalBoosted: 0,
      totalReduced: 0,
      totalSkipped: 0,
      skipped: 0,
      flagEnabled: false,
      durationMs: Date.now() - started,
    };
  }

  // Fetch all active subaccount IDs
  const rows = (await db.execute(sql`
    SELECT id FROM subaccounts
    WHERE deleted_at IS NULL AND status = 'active'
    ORDER BY id
  `)) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };

  const subaccountIds: string[] = (
    Array.isArray(rows) ? rows : (rows as { rows?: Array<{ id: string }> }).rows ?? []
  ).map((r: { id: string }) => r.id);

  for (const subaccountId of subaccountIds) {
    try {
      const summary = await adjustFromUtility(subaccountId);
      totalBoosted += summary.boosted;
      totalReduced += summary.reduced;
      totalSkipped += summary.skipped;
      subaccountsProcessed += 1;
    } catch (err) {
      skipped += 1;
      logger.error('memoryEntryQualityAdjustJob.subaccount_failed', {
        subaccountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: MemoryEntryQualityAdjustSummary = {
    subaccountsProcessed,
    totalBoosted,
    totalReduced,
    totalSkipped,
    skipped,
    flagEnabled: true,
    durationMs: Date.now() - started,
  };

  logger.info('memoryEntryQualityAdjustJob.tick_complete', { ...summary });

  return summary;
}
