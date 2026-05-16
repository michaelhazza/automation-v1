/**
 * sandboxEgressAuditPruneJob.ts — Daily prune of sandbox_egress_audit past 180 days.
 *
 * Spec B §17.3, §22, §22.1.
 *
 * Execution contract:
 *   - Org enumeration via withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Per-org DELETE in a fresh db.transaction + withOrgTx so RLS policies engage.
 *   - Per-org try/catch: one org failure is logged; iteration continues for other orgs.
 *   - Egress audit rows are physically deleted (no tombstone — spec §17.3).
 *     180-day retention is the minimum required for security audit purposes.
 *
 * Idempotency: cutoff-scoped (spec §22.1 row 2). Re-running with the same cutoff
 *   date is a no-op because matching rows have already been deleted.
 * Retry classification: safe (pg-boss retry is acceptable; DELETE WHERE is idempotent).
 * Cron: daily at 03:00 UTC (staggered from telemetry at 02:00 and logs at 02:30).
 */

import type PgBoss from 'pg-boss';
import { definePruneJob, type PruneJobResult } from './lib/definePruneJob.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_EGRESS_AUDIT_PRUNE_JOB } from '../lib/sandboxJobNames.js';

const SOURCE = 'sandbox-egress-audit-prune' as const;

export type SandboxEgressAuditPruneResult = PruneJobResult;

export const runSandboxEgressAuditPrune = definePruneJob({
  source: SOURCE,
  table: 'sandbox_egress_audit',
  retentionDays: 180,
  cutoffColumn: 'decision_at',
});

export async function registerSandboxEgressAuditPruneJob(boss: PgBoss): Promise<void> {
  await boss.work(
    SANDBOX_EGRESS_AUDIT_PRUNE_JOB,
    { teamSize: 1, teamConcurrency: 1 },
    async () => {
      try {
        await runSandboxEgressAuditPrune();
      } catch (err) {
        logger.error(`${SOURCE}.sweep_error`, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
  );
  logger.info(`${SOURCE}.handler_registered`);
}
