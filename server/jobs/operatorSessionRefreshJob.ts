/**
 * operatorSessionRefreshJob.ts — operator-session-identity chunk 6.
 *
 * Token refresh job for operator_session integration connections.
 *
 * Three exports:
 *   - processOperatorSessionRefresh(job) — per-connection refresh handler
 *   - enqueueOperatorSessionRefresh(connectionId, refreshBucketEpochSec) — singletonKey enqueuer
 *   - runOperatorSessionRefreshSweep() — nightly sweep that finds connections needing refresh
 *
 * V1 note: The actual token refresh is mocked (connectionMechanism = 'none_verified').
 * The handler stores placeholder tokens. Real OAuth handshake wires in when the
 * provider registry flips to a live mechanism.
 *
 * Cross-org pattern:
 *   - Admin read (withAdminConnection + SET LOCAL ROLE admin_role) to resolve org context.
 *   - Per-tenant write (db.transaction + set_config + withOrgTx) for the actual update.
 *
 * Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §9
 */

import { sql, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections } from '../db/schema/index.js';
import { operatorSessionLifecycleService } from '../services/operatorSessionLifecycleService.js';
import { classifyRefreshFailure, type UsabilityState } from '../services/operatorSessionLifecycleServicePure.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { auditService } from '../services/auditService.js';
import { logger } from '../lib/logger.js';
import { getJobConfig } from '../config/jobConfig.js';

const REFRESH_WINDOW_MINUTES = 30;
// Cap the sweep to avoid unbounded enqueue storms when many connections expire in the same window.
// A subsequent sweep tick picks up the remainder; the singletonKey bucket dedupes overlaps.
const SWEEP_BATCH_LIMIT = 500;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function processOperatorSessionRefresh(
  job: { data: { connectionId: string } },
): Promise<void> {
  const { connectionId } = job.data;

  // Step 1: Admin read — resolve org context without holding a long-lived tx.
  // withAdminConnection wraps a transaction internally. We need SET LOCAL ROLE
  // admin_role so the SELECT bypasses RLS on integration_connections.
  //
  // Return the result directly from withAdminConnection so TypeScript's control-
  // flow analysis can narrow conn after the call (assigning inside an async
  // callback prevents narrowing because TS cannot prove the callback was called).
  type ConnRow = {
    id: string;
    organisationId: string;
    usabilityState: string | null;
    tokenExpiresAt: Date | null;
  };

  const conn = await withAdminConnection<ConnRow | null>(
    {
      source: 'operatorSessionRefreshJob',
      reason: 'Read connection org context for token refresh',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      const rows = await tx.execute(sql`
        SELECT id, organisation_id, usability_state, token_expires_at
        FROM integration_connections
        WHERE id = ${connectionId}::uuid
          AND auth_type = 'operator_session'
        LIMIT 1
      `);
      const first = (rows as unknown as Array<{
        id: string;
        organisation_id: string;
        usability_state: string | null;
        token_expires_at: Date | null;
      }>)[0];
      if (!first) return null;
      return {
        id: first.id,
        organisationId: first.organisation_id,
        usabilityState: first.usability_state,
        tokenExpiresAt: first.token_expires_at,
      };
    },
  );

  // Connection vanished — drop silently (may have been deleted between enqueue and execution)
  if (!conn) {
    logger.debug('operator_session_refresh.connection_not_found', { connectionId });
    return;
  }

  // Post-terminal gate: revoked/disabled connections must not be refreshed
  if (conn.usabilityState === 'revoked' || conn.usabilityState === 'disabled') {
    logger.debug('operator_session_refresh.skip_terminal', {
      connectionId,
      state: conn.usabilityState,
    });
    return;
  }

  // Step 2: Per-tenant write inside an org-scoped transaction.
  // Pattern from server/routes/githubWebhook.ts and documentChunkEmbedJob.ts:
  //   db.transaction → set_config GUC → withOrgTx → getOrgScopedDb
  const orgId = conn.organisationId;

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organisation_id', ${orgId}, true)`,
    );

    await withOrgTx(
      {
        tx,
        organisationId: orgId,
        source: 'operatorSessionRefreshJob.processRefresh',
      },
      async () => {
        const scopedDb = getOrgScopedDb('operatorSessionRefreshJob.processRefresh');

        try {
          // V1: mock token refresh — connectionMechanism is 'none_verified'.
          // The real OAuth handshake wires in when the provider registry flips.
          const newToken = {
            access: 'placeholder-refreshed',
            refresh: 'placeholder-refresh',
            expiresAt: new Date(Date.now() + 3600 * 1000),
          };

          // Defence-in-depth: pin organisationId + authType so a future bug in
          // the admin lookup cannot let this UPDATE overwrite tokens in the
          // wrong tenant. Mirrors DEVELOPMENT_GUIDELINES §1.
          await scopedDb
            .update(integrationConnections)
            .set({
              accessToken: connectionTokenService.encryptToken(newToken.access),
              refreshToken: connectionTokenService.encryptToken(newToken.refresh),
              tokenExpiresAt: newToken.expiresAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(integrationConnections.id, connectionId),
                eq(integrationConnections.organisationId, orgId),
                eq(integrationConnections.authType, 'operator_session'),
              ),
            );

          await auditService.log({
            organisationId: orgId,
            actorType: 'system',
            action: 'operator_session.refreshed',
            entityType: 'integration_connection',
            entityId: connectionId,
            metadata: { status: 'success' },
          });
        } catch (err) {
          const classification = classifyRefreshFailure(err);

          if (classification.marksUnusable && classification.nextState) {
            // Terminal failure — transition state and log; do not rethrow
            await operatorSessionLifecycleService.transition({
              connectionId,
              organisationId: orgId,
              from: (conn.usabilityState ?? 'connected_usable') as UsabilityState,
              to: classification.nextState,
              cause: 'token_refresh_failed',
              actorUserId: null,
            });

            await auditService.log({
              organisationId: orgId,
              actorType: 'system',
              action:
                classification.nextState === 'revoked'
                  ? 'operator_session.revoked'
                  : 'operator_session.needs_reauth',
              entityType: 'integration_connection',
              entityId: connectionId,
              metadata: { status: 'failed', bucket: classification.bucket },
            });
          } else {
            // Retryable — partial audit + rethrow so pg-boss reschedules
            await auditService.log({
              organisationId: orgId,
              actorType: 'system',
              action: 'operator_session.refresh_retried',
              entityType: 'integration_connection',
              entityId: connectionId,
              metadata: { status: 'partial', bucket: classification.bucket },
            });
            throw err;
          }
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Enqueuer
// ---------------------------------------------------------------------------

/**
 * Enqueue a token refresh job for a single connection.
 *
 * singletonKey = `${connectionId}:${refreshBucketEpochSec}` — pg-boss deduplicates
 * multiple enqueues within the same 5-minute bucket so rapid signal storms
 * (e.g. multiple sweep ticks) collapse to one job.
 */
export async function enqueueOperatorSessionRefresh(
  connectionId: string,
  refreshBucketEpochSec: number,
): Promise<void> {
  const { getPgBoss } = await import('../lib/pgBossInstance.js');
  const boss = await getPgBoss();
  await boss.send(
    'operator-session-refresh',
    { connectionId },
    {
      ...getJobConfig('operator-session-refresh'),
      singletonKey: `${connectionId}:${refreshBucketEpochSec}`,
    },
  );
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Find all operator_session connections expiring within REFRESH_WINDOW_MINUTES
 * and enqueue a refresh job for each one.
 *
 * Exported as a standalone function — nightly cron wiring is a follow-up.
 * Call directly from a scheduled task or a pg-boss cron job.
 */
export async function runOperatorSessionRefreshSweep(): Promise<void> {
  const refreshWindowMs = REFRESH_WINDOW_MINUTES * 60 * 1000;
  const expiryThreshold = new Date(Date.now() + refreshWindowMs);

  await withAdminConnection(
    {
      source: 'operatorSessionRefreshSweep',
      reason: 'Nightly operator session token refresh sweep',
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Get DB-side 5-minute refresh bucket to deduplicate rapid re-sweeps
      const bucketResult = await tx.execute(sql`
        SELECT FLOOR(EXTRACT(EPOCH FROM transaction_timestamp()) / 300)::int AS refresh_bucket
      `);
      const refreshBucket =
        (bucketResult as unknown as Array<{ refresh_bucket: number }>)[0]?.refresh_bucket ??
        Math.floor(Date.now() / 300_000);

      const rows = await tx.execute(sql`
        SELECT id, organisation_id
        FROM integration_connections
        WHERE auth_type = 'operator_session'
          AND connection_status = 'active'
          AND usability_state = 'connected_usable'
          AND token_expires_at <= ${expiryThreshold}
        ORDER BY token_expires_at ASC
        LIMIT ${SWEEP_BATCH_LIMIT}
      `);

      const connections = rows as unknown as Array<{
        id: string;
        organisation_id: string;
      }>;

      for (const row of connections) {
        try {
          await enqueueOperatorSessionRefresh(row.id, refreshBucket);
        } catch (err) {
          logger.warn('operator_session_refresh_sweep.enqueue_failed', {
            connectionId: row.id,
            error: err,
          });
        }
      }

      logger.info('operator_session_refresh_sweep.complete', {
        connectionsFound: connections.length,
        batchLimit: SWEEP_BATCH_LIMIT,
        batchSaturated: connections.length >= SWEEP_BATCH_LIMIT,
        refreshBucket,
      });
    },
  );
}
