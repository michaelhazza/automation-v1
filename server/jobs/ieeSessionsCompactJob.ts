/**
 * maintenance:iee-sessions-compact
 * Compacts iee_sessions.summary blobs older than 90 days by setting them to null.
 * Retains rows; only frees TOAST storage. Only compacts rows in terminal states
 * ('torn_down', 'failed').
 * Scheduled daily at 5am UTC in queueService.ts.
 *
 * Idempotency: state-based (WHERE summary IS NOT NULL is idempotent).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'iee-sessions-compact' as const;
const RETENTION_DAYS = 90;

export interface IeeSessionsCompactResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsCompacted: number;
  durationMs: number;
}

export async function runIeeSessionsCompact(): Promise<IeeSessionsCompactResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Phase 1 — fetch org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Daily iee_sessions summary compaction: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: IeeSessionsCompactResult = {
      status: 'failed',
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      rowsCompacted: 0,
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
  let rowsCompacted = 0;

  // Phase 2 — per-org compaction inside a fresh tenant-scoped tx.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      const compactedCount = await db.transaction(async (orgTx) => {
        await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
        return withOrgTx(
          { tx: orgTx, organisationId: org.id, source: `${SOURCE}:per-org` },
          async () => {
            const updated = (await orgTx.execute(
              sql`UPDATE iee_sessions
                  SET summary = NULL
                  WHERE organisation_id = ${org.id}::uuid
                    AND status IN ('torn_down', 'failed')
                    AND created_at < ${cutoff}
                    AND summary IS NOT NULL
                  RETURNING id`,
            )) as unknown as Array<{ id: string }>;
            return updated.length;
          },
        );
      });

      rowsCompacted += compactedCount;
      orgsSucceeded++;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        rowsCompacted: compactedCount,
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

  const status: IeeSessionsCompactResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: IeeSessionsCompactResult = {
    status,
    orgsAttempted: orgs.length,
    orgsSucceeded,
    orgsFailed,
    rowsCompacted,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
