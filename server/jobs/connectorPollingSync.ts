import { eq, sql } from 'drizzle-orm';
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
  const safetyWindowInterval = `${DEFAULT_POLL_INTERVAL_MINUTES * SYNC_LEASE_SAFETY_MULTIPLIER} minutes`;

  // Acquire lease
  const leaseResult = await db.execute(sql`
    UPDATE integration_connections
    SET sync_lock_token = gen_random_uuid(),
        last_sync_started_at = now()
    WHERE id = ${connectionId}
      AND (
        sync_lock_token IS NULL
        OR now() - last_sync_started_at > interval '${sql.raw(safetyWindowInterval)}'
      )
    RETURNING sync_lock_token
  `);

  if (!leaseResult.rows || leaseResult.rows.length === 0) {
    return; // Another sync holds the lease
  }

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
      .where(eq(integrationConnections.id, connectionId));

    // Record stats
    await db.insert(integrationIngestionStats).values({
      connectionId,
      organisationId,
      syncStartedAt,
      syncFinishedAt: new Date(),
      apiCallsApprox: result.apiCallsApprox,
      rowsIngested: result.rowsIngested,
      syncDurationMs: result.durationMs,
      syncPhase: 'live',
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(integrationConnections)
      .set({
        lastSyncError: errorMessage,
        lastSyncErrorAt: new Date(),
      })
      .where(eq(integrationConnections.id, connectionId));

    // Record failed stats
    await db.insert(integrationIngestionStats).values({
      connectionId,
      organisationId,
      syncStartedAt,
      syncFinishedAt: new Date(),
      apiCallsApprox: 0,
      rowsIngested: 0,
      syncDurationMs: Date.now() - syncStartedAt.getTime(),
      syncPhase: 'live',
      errorMessage,
    });

    // Don't throw — job completes; TripWire monitors error rates
  }
}
