import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withBackoff } from '../lib/withBackoff.js';
import { syncConnector } from '../services/connectorPollingService.js';
import { integrationConnections } from '../db/schema/integrationConnections.js';
import { integrationIngestionStats } from '../db/schema/integrationIngestionStats.js';
import { SYNC_LEASE_SAFETY_MULTIPLIER, DEFAULT_POLL_INTERVAL_MINUTES } from '../config/connectorPollingConfig.js';

export interface ConnectorPollingSyncPayload {
  organisationId: string;
  connectionId: string;
}

export async function runConnectorPollingSync(
  payload: ConnectorPollingSyncPayload,
): Promise<void> {
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

  if (!leaseResult.rows || leaseResult.rows.length === 0) {
    return; // Another sync holds the lease
  }

  const leaseRow = leaseResult.rows[0] as { sync_lock_token: string; sync_phase: string };
  const validPhases = ['backfill', 'transition', 'live'] as const;
  const rawPhase = leaseRow.sync_phase;
  if (!validPhases.includes(rawPhase as typeof validPhases[number])) {
    throw new Error(`connectorPollingSync: unexpected sync_phase '${rawPhase}' on connection ${connectionId}`);
  }
  const currentSyncPhase = rawPhase;
  const syncStartedAt = new Date();
  let errorMessage: string | null = null;

  try {
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

    // Success — clear lease and update timestamps
    await db
      .update(integrationConnections)
      .set({
        syncLockToken: null,
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

    await db
      .update(integrationConnections)
      .set({
        syncLockToken: null,
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

    // Don't throw — job completes; TripWire monitors error rates
  }
}
