/**
 * maintenance:fast-path-decisions-prune
 * Prunes fast_path_decisions rows older than 90 days across all organisations.
 * Scheduled daily at 03:30 UTC in queueService.ts.
 *
 * Execution contract (Phase 3 — B10-MAINT-RLS):
 *   - withAdminConnection + SET LOCAL ROLE admin_role to bypass RLS for the
 *     cross-org prune sweep (no app.organisation_id → fail-closed otherwise).
 *   - Sequential per-org processing; no parallel fan-out in v1.
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

  let result: FastPathDecisionsPruneResult;

  try {
    result = await withAdminConnection(
      { source: SOURCE, reason: 'Daily cross-org prune of fast_path_decisions rows older than 90 days' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

        const orgs = (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;

        let orgsSucceeded = 0;
        let orgsFailed = 0;
        let rowsDeleted = 0;

        for (const org of orgs) {
          logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
          const orgStart = Date.now();
          try {
            const deleted = (await tx.execute(
              sql`DELETE FROM fast_path_decisions WHERE organisation_id = ${org.id}::uuid AND decided_at < ${cutoff} RETURNING id`,
            )) as unknown as Array<{ id: string }>;
            rowsDeleted += deleted.length;
            orgsSucceeded++;
            logger.info(`${SOURCE}.org_completed`, {
              jobRunId,
              orgId: org.id,
              rowsAffected: deleted.length,
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

        return {
          status,
          orgsAttempted: orgs.length,
          orgsSucceeded,
          orgsFailed,
          rowsDeleted,
          durationMs: Date.now() - startedAt,
        };
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    result = {
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

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
