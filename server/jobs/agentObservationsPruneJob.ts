/**
 * maintenance:agent-observations-prune
 * Prunes non-pinned agent_observations rows older than 90 days across all organisations.
 * Scheduled daily at 5:30am UTC in queueService.ts.
 *
 * Execution contract (Rev 3 batching invariant):
 *   - Org enumeration via withAdminConnection.
 *   - Per-org DELETE runs in batches of 1000 rows, ordered by (created_at ASC, id ASC),
 *     looping until a batch returns 0 rows. Each batch is its own per-org transaction.
 *   - Before each batch DELETE, sets GUC app.allow_observation_mutation = 'retention_prune'
 *     inside the transaction to bypass the immutability trigger on agent_observations.
 *   - Per-org try/catch: one org failure is logged; iteration continues.
 *   - Security audit event emitted after each org's prune completes.
 *
 * Idempotency: state-based (re-running recomputes from current data; DELETE WHERE
 *   created_at < cutoff AND pinned_at IS NULL is idempotent against the current state).
 * Retry classification: safe (pg-boss retry is acceptable).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { recordSecurityEvent } from '../services/securityAuditService.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

const SOURCE = 'agent-observations-prune' as const;
const RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;

export interface AgentObservationsPruneResult {
  status: 'success' | 'partial' | 'failed';
  orgsAttempted: number;
  orgsSucceeded: number;
  orgsFailed: number;
  rowsDeleted: number;
  durationMs: number;
}

export async function runAgentObservationsPrune(): Promise<AgentObservationsPruneResult> {
  const jobRunId = crypto.randomUUID();
  const startedAt = Date.now();

  logger.info(`${SOURCE}.started`, { jobRunId, scheduledAt: new Date().toISOString() });

  // Phase 1 — fetch org list under one short-lived admin tx.
  let orgs: Array<{ id: string }>;
  try {
    orgs = await withAdminConnection(
      { source: SOURCE, reason: 'Daily cross-org prune of agent_observations: enumerate orgs', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return (await tx.execute(
          sql`SELECT id FROM organisations`,
        )) as unknown as Array<{ id: string }>;
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result: AgentObservationsPruneResult = {
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

  // Phase 2 — per-org batched DELETE, each batch in its own tenant-scoped tx.
  for (const org of orgs) {
    logger.info(`${SOURCE}.org_started`, { jobRunId, orgId: org.id });
    const orgStart = Date.now();
    try {
      let orgRowsDeleted = 0;
      let batchCount = 0;

      // Loop until a batch returns 0 rows (batching invariant from Rev 3).
      while (true) {
        const batchDeleted = await db.transaction(async (orgTx) => {
          await orgTx.execute(sql`SELECT set_config('app.organisation_id', ${org.id}, true)`);
          return withOrgTx(
            { tx: orgTx, organisationId: org.id, source: `${SOURCE}:per-org-batch` },
            async () => {
              // Set GUC to bypass immutability trigger on agent_observations.
              await orgTx.execute(
                sql`SELECT set_config('app.allow_observation_mutation', 'retention_prune', true)`,
              );

              const deleted = (await orgTx.execute(
                sql`DELETE FROM agent_observations
                    WHERE id IN (
                      SELECT id FROM agent_observations
                      WHERE organisation_id = ${org.id}::uuid
                        AND pinned_at IS NULL
                        AND created_at < NOW() - INTERVAL '${sql.raw(String(RETENTION_DAYS))} days'
                      ORDER BY created_at ASC, id ASC
                      LIMIT ${BATCH_SIZE}
                      FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id`,
              )) as unknown as Array<{ id: string }>;
              return deleted.length;
            },
          );
        });

        orgRowsDeleted += batchDeleted;
        batchCount++;

        if (batchDeleted < BATCH_SIZE) {
          // Batch returned fewer than the limit — no more rows to prune.
          break;
        }

        logger.debug(`${SOURCE}.batch_completed`, {
          jobRunId,
          orgId: org.id,
          batchCount,
          batchDeleted,
        });
      }

      rowsDeleted += orgRowsDeleted;
      orgsSucceeded++;

      const orgDurationMs = Date.now() - orgStart;
      logger.info(`${SOURCE}.org_completed`, {
        jobRunId,
        orgId: org.id,
        rowsDeleted: orgRowsDeleted,
        batchCount,
        durationMs: orgDurationMs,
        status: 'success',
      });

      // Emit security audit event for this org's prune.
      await recordSecurityEvent({
        event: auditEvent.agent.observationsRetentionPrune,
        organisationId: org.id,
        meta: { rowsDeleted: orgRowsDeleted, durationMs: orgDurationMs },
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

  const status: AgentObservationsPruneResult['status'] =
    orgsFailed === 0 ? 'success'
    : orgsSucceeded === 0 ? 'failed'
    : 'partial';

  const result: AgentObservationsPruneResult = {
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
