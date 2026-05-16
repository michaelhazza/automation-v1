/**
 * sandboxTelemetryPruneJob.ts — Daily prune of sandbox_telemetry_events past 90 days.
 *
 * Spec B §17.3, §22, §22.1.
 *
 * Execution contract:
 *   - Org enumeration via withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Per-org DELETE in a fresh db.transaction + withOrgTx so RLS policies engage.
 *   - Per-org try/catch: one org failure is logged; iteration continues for other orgs.
 *   - Telemetry events are physically deleted (no tombstone — spec §17.3). The
 *     sandbox_executions row is the post-prune summary.
 *
 * Idempotency: cutoff-scoped (spec §22.1 row 2). Re-running with the same cutoff
 *   date is a no-op because matching rows have already been deleted.
 * Retry classification: safe (pg-boss retry is acceptable; DELETE WHERE is idempotent).
 * Cron: daily at 02:00 UTC (distinct from logs at 02:30 and egress at 03:00).
 */

import type PgBoss from 'pg-boss';
import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_TELEMETRY_PRUNE_JOB } from '../lib/sandboxJobNames.js';

const SOURCE = 'sandbox-telemetry-prune' as const;

export type SandboxTelemetryPruneResult = PruneJobResult;

export const runSandboxTelemetryPrune = definePruneJob({
  source: SOURCE,
  table: 'sandbox_telemetry_events',
  retentionDays: 90,
  cutoffColumn: 'event_at',
});

export async function registerSandboxTelemetryPruneJob(boss: PgBoss): Promise<void> {
  await boss.work(
    SANDBOX_TELEMETRY_PRUNE_JOB,
    { teamSize: 1, teamConcurrency: 1 },
    async () => {
      try {
        await runSandboxTelemetryPrune();
      } catch (err) {
        logger.error(`${SOURCE}.sweep_error`, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
  );
  logger.info(`${SOURCE}.handler_registered`);
}
