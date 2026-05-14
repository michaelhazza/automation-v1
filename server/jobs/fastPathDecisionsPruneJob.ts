/**
 * maintenance:fast-path-decisions-prune
 * Prunes fast_path_decisions rows older than 90 days across all organisations.
 * Scheduled daily at 03:30 UTC in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - Org enumeration in a short-lived withAdminConnection + SET LOCAL ROLE admin_role.
 *   - Sequential per-org processing; no parallel fan-out in v1.
 *   - Per-org DELETE runs in a fresh db.transaction + withOrgTx so that
 *     app.organisation_id is set and RLS policies engage for each org's work.
 *     A per-org error does not abort the surrounding sweep.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Terminal event emitted with outcome counters regardless of mixed results.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE
 *   WHERE decided_at < cutoff is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
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

  // Phase 2 — per-org work, each in a fresh tenant-scoped tx so RLS policies
  // are engaged for every DELETE. A per-org failure does not abort the sweep.
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
              sql`DELETE FROM fast_path_decisions WHERE organisation_id = ${org.id}::uuid AND decided_at < ${cutoff} RETURNING id`,
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
