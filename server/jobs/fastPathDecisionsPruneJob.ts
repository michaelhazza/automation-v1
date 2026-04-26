/**
 * maintenance:fast-path-decisions-prune
 * Prunes fast_path_decisions rows older than 90 days across all organisations.
 * Scheduled daily at 03:30 UTC in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS for the
 *     cross-org prune sweep (no app.organisation_id → fail-closed otherwise).
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - One admin transaction PER ORG. The org-list enumeration runs in its own
 *     short-lived admin tx; each per-org DELETE runs in a fresh admin tx so
 *     a Postgres statement error in one org does not abort the surrounding
 *     transaction and poison every later org's work. Without this split,
 *     "partial" status is unachievable: after one tx.execute throws, every
 *     subsequent tx.execute in the same tx fails with "current transaction
 *     is aborted".
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE
 *   WHERE decided_at < cutoff is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'fast-path-decisions-prune' as const;
const RETENTION_DAYS = 90;

export interface FastPathDecisionsPruneResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsDeleted: number;
  durationMs: number;
}

export async function pruneFastPathDecisions(): Promise<FastPathDecisionsPruneResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Phase 1 — fetch the org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Daily cross-org prune of fast_path_decisions: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: FastPathDecisionsPruneResult = {
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

  // Phase 2 — per-org work, each in its own admin tx so a per-org failure
  // does not abort the surrounding transaction.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      const deletedCount = await withAdminConnection(
        { source: SOURCE, reason: `Daily prune for org ${org.id}`, skipAudit: true },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          const deleted = (await tx.execute(
            sql`DELETE FROM fast_path_decisions WHERE organisation_id = ${org.id}::uuid AND decided_at < ${cutoff} RETURNING id`,
          )) as unknown as Array<{ id: string }>;
          return deleted.length;
        },
      );
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

  const status: FastPathDecisionsPruneResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: FastPathDecisionsPruneResult = {
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
