/**
 * sandboxLogsPruneJob.ts — Daily prune of sandbox_logs past 90 days.
 *
 * Spec B §17.3, §22, §22.1.
 *
 * Execution contract:
 *   - Org enumeration via withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Per-org DELETE in a fresh db.transaction + withOrgTx so RLS policies engage.
 *   - Per-org try/catch: one org failure is logged; iteration continues for other orgs.
 *   - Logs are physically deleted (no tombstone — spec §17.3). This includes both
 *     soft-deleted rows (is_active = false, already run-deleted) and rows past the
 *     90-day retention window. The DELETE uses persisted_at as the age boundary
 *     (the wall-clock time the row landed in DB, independent of sandbox activity time).
 *
 * Idempotency: cutoff-scoped (spec §22.1 row 2). Re-running with the same cutoff
 *   date is a no-op because matching rows have already been deleted.
 * Retry classification: safe (pg-boss retry is acceptable; DELETE WHERE is idempotent).
 * Cron: daily at 02:30 UTC (staggered from telemetry at 02:00 and egress at 03:00).
 */

import type PgBoss from 'pg-boss';
import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_LOGS_PRUNE_JOB } from '../lib/sandboxJobNames.js';

const SOURCE = 'sandbox-logs-prune' as const;

export type SandboxLogsPruneResult = PruneJobResult;

// extraWhere 'OR is_active = false' extends the cutoff condition with an OR branch so that
// soft-deleted rows are also pruned regardless of age (spec §17.3 + §17.4).
export const runSandboxLogsPrune = definePruneJob({
  source: SOURCE,
  table: 'sandbox_logs',
  retentionDays: 90,
  cutoffColumn: 'persisted_at',
  extraWhere: 'OR is_active = false',
});

export async function registerSandboxLogsPruneJob(boss: PgBoss): Promise<void> {
  await boss.work(
    SANDBOX_LOGS_PRUNE_JOB,
    { teamSize: 1, teamConcurrency: 1 },
    async () => {
      try {
        await runSandboxLogsPrune();
      } catch (err) {
        logger.error(`${SOURCE}.sweep_error`, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
  );
  logger.info(`${SOURCE}.handler_registered`);
}
