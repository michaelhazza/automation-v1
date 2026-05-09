/**
 * maintenance:iee-session-orphan-cleanup
 * Walks iee_sessions rows with NULL released_at whose associated agentRuns.status
 * is terminal. Calls ieeSessionService.tearDown per session.
 * Scheduled every 5 minutes in queueService.ts.
 *
 * Execution contract:
 *   - Org enumeration via withAdminConnection.
 *   - Per-org processing with tearDown called in org context.
 *   - Per-org try/catch; failures log error + continue.
 *
 * Idempotency: state-based (tearDown is a no-op for already-released sessions).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { ieeSessions } from '../db/schema/index.js';
import { agentRuns } from '../db/schema/index.js';
import { tearDown } from '../services/ieeSessionService.js';
import type { SystemPrincipal } from '../services/principal/types.js';

const SOURCE = 'iee-session-orphan-cleanup' as const;

const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'timeout',
  'cancelled',
  'loop_detected',
  'budget_exceeded',
  'completed_with_uncertainty',
] as const;

export interface IeeSessionOrphanCleanupResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  sessionsProcessed: number;
  durationMs: number;
}

export async function runIeeSessionOrphanCleanup(): Promise<IeeSessionOrphanCleanupResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  // Phase 1 — fetch the org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Orphan cleanup sweep: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: IeeSessionOrphanCleanupResult = {
      status: 'failed',
      orgsAttempted: 0,
      orgsSucceeded: 0,
      orgsFailed: 0,
      sessionsProcessed: 0,
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
  let sessionsProcessed = 0;

  // Phase 2 — per-org work. Find orphaned sessions (not released but run is terminal),
  // then tearDown each one.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      // Find orphaned sessions for this org.
      const orphanedSessions = await db.transaction(async (orgTx) => {
        await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
        return withOrgTx(
          { tx: orgTx, organisationId: org.id, source: `${SOURCE}:find-orphans` },
          async () => {
            return orgTx
              .select({ id: ieeSessions.id })
              .from(ieeSessions)
              .innerJoin(agentRuns, eq(ieeSessions.runId, agentRuns.id))
              .where(
                // Use SQL for the compound condition to keep it readable and
                // avoid Drizzle's typed-status friction with inArray on foreign tables.
                sql`${ieeSessions.organisationId} = ${org.id}::uuid
                    AND ${ieeSessions.releasedAt} IS NULL
                    AND ${agentRuns.status} = ANY(${TERMINAL_STATUSES}::text[])`,
              );
          },
        );
      });

      if (orphanedSessions.length === 0) {
        orgsSucceeded++;
        logger.info(`${SOURCE}.org_completed`, {
          jobRunId,
          orgId: org.id,
          sessionsProcessed: 0,
          durationMs: Date.now() - orgStart,
          status: 'success',
        });
        continue;
      }

      let orgSessionsProcessed = 0;
      const ctx: SystemPrincipal = {
        type: 'system',
        id: 'orphan-cleanup-job',
        organisationId: org.id,
        subaccountId: null,
        teamIds: [],
        isSystemPrincipal: true,
      };

      for (const session of orphanedSessions) {
        try {
          await tearDown(session.id, 'orphan_cleanup', ctx);
          orgSessionsProcessed++;
        } catch (sessionErr) {
          logger.error(`${SOURCE}.session_teardown_failed`, {
            jobRunId,
            orgId: org.id,
            sessionId: session.id,
            error: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
          });
        }
      }

      sessionsProcessed += orgSessionsProcessed;
      orgsSucceeded++;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        sessionsProcessed: orgSessionsProcessed,
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

  const status: IeeSessionOrphanCleanupResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: IeeSessionOrphanCleanupResult = {
    status,
    orgsAttempted: orgs.length,
    orgsSucceeded,
    orgsFailed,
    sessionsProcessed,
    durationMs: Date.now() - startedAt,
  };

  logger.info(`${SOURCE}.completed`, { jobRunId, ...result });
  return result;
}
