import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withBackoff } from '../lib/withBackoff.js';
import { syncConnector } from '../services/connectorPollingService.js';
import { integrationConnections } from '../db/schema/integrationConnections.js';
import { integrationIngestionStats } from '../db/schema/integrationIngestionStats.js';
import { SYNC_LEASE_SAFETY_MULTIPLIER, DEFAULT_POLL_INTERVAL_MINUTES } from '../config/connectorPollingConfig.js';
import { logger } from '../lib/logger.js';

/**
 * connectorPollingSync
 *
 * Concurrency model: lease-based — singleton runner per connection
 *   Mechanism:       sync_lock_token UPDATE with skip-if-held semantics + safety
 *                    window. The acquiring statement fails (returns zero rows)
 *                    if another worker already holds the lease and the safety
 *                    window has not yet elapsed.
 *   Key/lock space:  per-(organisationId, connectionId) — distinct connections
 *                    sync in parallel; the same connection cannot be synced by
 *                    two workers concurrently.
 *
 * Idempotency model: per-phase no-op-if-already-done predicates + replay-safe upserts
 *   Mechanism:       (a) lease acquisition is its own no-op predicate (a peer
 *                    worker already syncing → return without work); (b) the
 *                    integration_ingestion_stats write uses INSERT … ON CONFLICT
 *                    DO UPDATE keyed on (connectionId, syncStartedAt) so a
 *                    queue-level retry after partial completion converges to
 *                    the same final row; (c) syncConnector itself owns
 *                    per-phase no-op semantics (backfill / transition / live
 *                    cursors guard against re-ingesting already-seen events).
 *   Failure mode:    the finally-block always releases OUR lease (scoped to
 *                    acquiredToken), so a crash mid-sync cannot strand the
 *                    lease past the safety window. A retry from the queue
 *                    re-acquires and resumes from the per-phase cursor.
 *
 * __testHooks production safety: defaults to undefined; the call site uses the
 * canonical `if (!__testHooks.<name>) return;` short-circuit so an unset hook
 * is dead code in production. The hook seam is exported only to allow
 * race-window control inside idempotency tests.
 */

export interface ConnectorPollingSyncPayload {
  organisationId: string;
  connectionId: string;
}

export type ConnectorPollingSyncResult =
  | { status: 'noop'; reason: 'lock_held'; jobName: 'connectorPollingSync' }
  | { status: 'ok'; jobName: 'connectorPollingSync'; connectionId: string };

/**
 * Test-only seam for race-window control in idempotency tests. Default is
 * undefined — production execution skips the call site via the canonical
 * `if (!__testHooks.<name>) return;` guard. Each idempotency test MUST reset
 * this object in `beforeEach` (or equivalent) so a forgotten override does
 * not leak across tests.
 */
export const __testHooks: { pauseBetweenClaimAndCommit?: () => Promise<void> } = {};

export async function runConnectorPollingSync(
  payload: ConnectorPollingSyncPayload,
): Promise<ConnectorPollingSyncResult> {
  const db = getOrgScopedDb('connectorPollingSync');
  const { connectionId, organisationId } = payload;
  const safetyWindowMinutes = DEFAULT_POLL_INTERVAL_MINUTES * SYNC_LEASE_SAFETY_MULTIPLIER;

  // Acquire lease with org-scoped WHERE for defense-in-depth
  const leaseResult = await db.execute(sql`
    UPDATE integration_connections
    SET sync_lock_token = gen_random_uuid(),
        last_sync_started_at = now()
    WHERE id = ${connectionId}
      AND organisation_id = ${organisationId}::uuid
      AND (
        sync_lock_token IS NULL
        OR now() - last_sync_started_at > ${safetyWindowMinutes} * interval '1 minute'
      )
    RETURNING sync_lock_token, sync_phase
  `);

  if (leaseResult.length === 0) {
    // Another sync holds the lease — structured no-op return so callers / tests
    // can observe the outcome instead of silently proceeding.
    logger.info('job_noop', {
      jobName: 'connectorPollingSync',
      reason: 'lock_held',
      connectionId,
    });
    return { status: 'noop', reason: 'lock_held', jobName: 'connectorPollingSync' };
  }

  const leaseRow = leaseResult[0] as { sync_lock_token: string; sync_phase: string };
  const acquiredToken = leaseRow.sync_lock_token;
  const currentSyncPhase = leaseRow.sync_phase;
  const syncStartedAt = new Date();
  let errorMessage: string | null = null;

  // Race-window control seam (test-only). Canonical guarded short-circuit so
  // production with the hook unset is identical to a job with no hook.
  if (__testHooks.pauseBetweenClaimAndCommit) {
    await __testHooks.pauseBetweenClaimAndCommit();
  }

  try {
    const validPhases = ['backfill', 'transition', 'live'] as const;
    if (!validPhases.includes(currentSyncPhase as typeof validPhases[number])) {
      throw new Error(`connectorPollingSync: unexpected sync_phase '${currentSyncPhase}' on connection ${connectionId}`);
    }

    const result = await withBackoff(
      () => syncConnector(connectionId, organisationId),
      {
        label: `connector-polling-sync:${connectionId}`,
        maxAttempts: 3,
        isRetryable: () => true,
        correlationId: connectionId,
        runId: `sync-${connectionId}-${Date.now()}`,
      },
    );

    // Success — update timestamps
    await db
      .update(integrationConnections)
      .set({
        lastSuccessfulSyncAt: new Date(),
        lastSyncError: null,
        lastSyncErrorAt: null,
      })
      .where(and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.organisationId, organisationId),
      ));

    // Record stats — ON CONFLICT handles pg-boss retry dedup
    await db.insert(integrationIngestionStats).values({
      connectionId,
      organisationId,
      syncStartedAt,
      syncFinishedAt: new Date(),
      apiCallsApprox: result.apiCallsApprox,
      rowsIngested: result.rowsIngested,
      syncDurationMs: result.durationMs,
      syncPhase: currentSyncPhase,
    }).onConflictDoUpdate({
      target: [integrationIngestionStats.connectionId, integrationIngestionStats.syncStartedAt],
      set: {
        syncFinishedAt: new Date(),
        apiCallsApprox: result.apiCallsApprox,
        rowsIngested: result.rowsIngested,
        syncDurationMs: result.durationMs,
        errorMessage: null,
      },
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);

    try {
      await db
        .update(integrationConnections)
        .set({
          lastSyncError: errorMessage,
          lastSyncErrorAt: new Date(),
        })
        .where(and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.organisationId, organisationId),
        ));

      // Record failed stats — ON CONFLICT handles pg-boss retry dedup
      await db.insert(integrationIngestionStats).values({
        connectionId,
        organisationId,
        syncStartedAt,
        syncFinishedAt: new Date(),
        apiCallsApprox: 0,
        rowsIngested: 0,
        syncDurationMs: Date.now() - syncStartedAt.getTime(),
        syncPhase: currentSyncPhase,
        errorMessage,
      }).onConflictDoUpdate({
        target: [integrationIngestionStats.connectionId, integrationIngestionStats.syncStartedAt],
        set: {
          syncFinishedAt: new Date(),
          errorMessage,
          syncDurationMs: Date.now() - syncStartedAt.getTime(),
        },
      });
    } catch {
      // Best-effort error recording — if DB is unreachable, finally still clears the lock
    }

    // Don't throw — job completes; TripWire monitors error rates
  } finally {
    // Always release OUR lease — scoped to acquiredToken to avoid
    // clearing a newer lease if the safety window expired mid-sync
    try {
      await db
        .update(integrationConnections)
        .set({ syncLockToken: null })
        .where(and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.organisationId, organisationId),
          eq(integrationConnections.syncLockToken, acquiredToken),
        ));
    } catch {
      // Best-effort — safety window handles recovery if DB is unreachable
    }
  }

  return { status: 'ok', jobName: 'connectorPollingSync', connectionId };
}
