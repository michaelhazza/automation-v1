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
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_TELEMETRY_PRUNE_JOB } from '../lib/sandboxJobNames.js';
import { computeRetentionCutoff } from './sandboxRetentionPure.js';

const SOURCE = 'sandbox-telemetry-prune' as const;
const RETENTION_DAYS = 90;

export interface SandboxTelemetryPruneResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsDeleted: number;
  durationMs: number;
}

export async function runSandboxTelemetryPrune(): Promise<SandboxTelemetryPruneResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();
  const cutoff = computeRetentionCutoff(new Date(), RETENTION_DAYS);

  logger.info(`${SOURCE}.started`, {
    jobRunId,
    scheduledAt: new Date().toISOString(),
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
  });

  // Phase 1 — fetch org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Daily cross-org prune of sandbox_telemetry_events: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: SandboxTelemetryPruneResult = {
      status: 'failed',
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      rowsDeleted: 0,
      durationMs,
    };
    logger.error(`${SOURCE}.completed`, {
      jobRunId,
      ...result,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  let orgsSucceeded = 0;
  let orgsFailed = 0;
  let rowsDeleted = 0;

  // Phase 2 — per-org DELETE, each in a fresh tenant-scoped tx so RLS engages.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      const deletedCount = await db.transaction(async (orgTx) => {
        await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
        return withOrgTx(
          { tx: orgTx, organisationId: org.id, source: `${SOURCE}:per-org` },
          async () => {
            const deleted = (await orgTx.execute(
              sql`DELETE FROM sandbox_telemetry_events
                  WHERE organisation_id = ${org.id}::uuid
                    AND event_at < ${cutoff}
                  RETURNING id`,
            )) as unknown as Array<{ id: string }>;
            return deleted.length;
          },
        );
      });
      rowsDeleted += deletedCount;
      orgsSucceeded++;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        rowsAffected: deletedCount,
        durationMs: Date.now() - orgStart,
        status: 'success',
      });
    } catch (err) {
      orgsFailed++;
      logger.error(`${SOURCE}.org_failed`, {
        jobRunId,
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
        errorClass: err instanceof Error ? 'tx_failure' : 'unknown',
        status: 'failed',
      });
    }
  }

  const status: SandboxTelemetryPruneResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: SandboxTelemetryPruneResult = {
    status,
    orgsAttempted: orgs.length,
    orgsSucceeded,
    orgsFailed,
    rowsDeleted,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}

/**
 * Register the sandbox telemetry prune worker with pg-boss.
 * Called from queueService.ts. Cron is scheduled there.
 */
export async function registerSandboxTelemetryPruneJob(boss: PgBoss): Promise<void> {
  await boss.work(
    SANDBOX_TELEMETRY_PRUNE_JOB,
    { teamSize: 1, teamConcurrency: 1 },
    async () => {
      try {
        await runSandboxTelemetryPrune();
      } catch (err) {
        logger.error(`${SOURCE}.sweep_error`, {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  );

  logger.info(`${SOURCE}.handler_registered`);
}
