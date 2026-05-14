/**
 * llmInflightHistoryCleanupJob — purges aged-out rows from
 * llm_inflight_history.
 *
 * Deferred-items brief §6: the archive is a short-TTL forensic log; the
 * authoritative long-term record is `llm_requests`. Retention defaults
 * to 7 days (env.LLM_INFLIGHT_HISTORY_RETENTION_DAYS).
 *
 * Schedule: once daily, staggered into the 04:15 UTC slot so it doesn't
 * contend with the 03:00 memory-decay / 03:45 llm-ledger-archive
 * cadence. Registered in queueService.ts.
 */

import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { llmInflightHistory } from '../db/schema/llmInflightHistory.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { computeInflightHistoryCutoff } from './llmInflightHistoryCleanupJobPure.js';

interface CleanupResult {
  rowsDeleted: number;
  cutoff:      string;
}

// @rls-allowlist-bypass: llm_inflight_history cleanOldInflightHistoryRows [ref: spec §3.3.1]
export async function cleanOldInflightHistoryRows(): Promise<CleanupResult> {
  const cutoff = computeInflightHistoryCutoff({
    nowMs:         Date.now(),
    retentionDays: env.LLM_INFLIGHT_HISTORY_RETENTION_DAYS,
  });
  // Plain `db` (not withAdminConnection) — llm_inflight_history has no RLS.
  // If RLS is ever added to this table (see brief §6 tripwires — "FORCE
  // ROW LEVEL SECURITY + admin bypass" option), switch to
  // withAdminConnection + `SET LOCAL ROLE admin_role` to match the
  // pattern in llmStartedRowSweepJob.ts / llmLedgerArchiveJob.ts.
  const result = await db
    .delete(llmInflightHistory)
    .where(lt(llmInflightHistory.createdAt, cutoff))
    .returning({ id: llmInflightHistory.id });
  const rowsDeleted = result.length;
  if (rowsDeleted > 0) {
    logger.info('llm_inflight_history_cleanup', { rowsDeleted, cutoff: cutoff.toISOString() });
  }
  return { rowsDeleted, cutoff: cutoff.toISOString() };
}
