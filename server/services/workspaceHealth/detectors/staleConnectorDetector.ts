/**
 * staleConnectorDetector.ts — Canonical Data Platform P1 detector (impure).
 *
 * Queries integration_connections for active connections, calls the pure
 * computeStaleness function, and returns WorkspaceHealthFinding[] for any
 * connections with severity !== 'none'.
 *
 * Unlike the pure detectors in ALL_DETECTORS that operate on a pre-fetched
 * DetectorContext, this detector performs its own DB read because connector
 * health data is not part of the shared DetectorContext. It is invoked
 * separately by the impure runner after the pure sweep.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { integrationConnections } from '../../../db/schema/integrationConnections.js';
import { connectorConfigs } from '../../../db/schema/connectorConfigs.js';
import { DEFAULT_POLL_INTERVAL_MINUTES } from '../../../config/connectorPollingConfig.js';
import type { WorkspaceHealthFinding } from '../detectorTypes.js';
import { computeStaleness } from './staleConnectorDetectorPure.js';
import type { ConnectorHealth } from './staleConnectorDetectorPure.js';

/**
 * Run the stale-connector detector for a single organisation.
 *
 * Queries active integration connections, evaluates staleness via the pure
 * function, and returns findings for any connection with severity !== 'none'.
 */
export async function detectStaleConnectors(
  organisationId: string,
): Promise<WorkspaceHealthFinding[]> {
  const now = new Date();

  // Fetch active connections with their sync tracking columns
  const rows = await db
    .select({
      id: integrationConnections.id,
      label: integrationConnections.label,
      displayName: integrationConnections.displayName,
      providerType: integrationConnections.providerType,
      connectionStatus: integrationConnections.connectionStatus,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      lastSyncError: integrationConnections.lastSyncError,
      lastSyncErrorAt: integrationConnections.lastSyncErrorAt,
      createdAt: integrationConnections.createdAt,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    );

  // Look up poll interval from connector_configs where available; fall back
  // to the global default otherwise.
  const configRows = await db
    .select({
      connectionId: connectorConfigs.connectionId,
      pollIntervalMinutes: connectorConfigs.pollIntervalMinutes,
    })
    .from(connectorConfigs)
    .where(eq(connectorConfigs.organisationId, organisationId));

  const intervalByConnectionId = new Map<string, number>();
  for (const c of configRows) {
    if (c.connectionId) {
      intervalByConnectionId.set(c.connectionId, c.pollIntervalMinutes);
    }
  }

  const findings: WorkspaceHealthFinding[] = [];

  for (const row of rows) {
    const health: ConnectorHealth = {
      connectionId: row.id,
      connectionLabel: row.displayName ?? row.label ?? row.providerType,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      lastSyncError: row.lastSyncError,
      lastSyncErrorAt: row.lastSyncErrorAt,
      pollIntervalMinutes: intervalByConnectionId.get(row.id) ?? DEFAULT_POLL_INTERVAL_MINUTES,
      createdAt: row.createdAt,
    };

    const result = computeStaleness(health, now);

    if (result.severity === 'none') continue;

    findings.push({
      detector: 'connection.stale_connector',
      severity: result.severity === 'error' ? 'critical' : 'warning',
      resourceKind: 'connection',
      resourceId: row.id,
      resourceLabel: health.connectionLabel,
      message: result.reason,
      recommendation:
        result.severity === 'error'
          ? 'Check the connection credentials and sync configuration; the connector may have lost access or the remote service may be down.'
          : 'Monitor this connection — it is falling behind its expected sync schedule.',
    });
  }

  return findings;
}
