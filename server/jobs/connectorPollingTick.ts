import type PgBoss from 'pg-boss';
import { and, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { selectConnectionsDue } from '../services/connectorPollingSchedulerPure.js';
import { DEFAULT_POLL_INTERVAL_MINUTES } from '../config/connectorPollingConfig.js';
import { integrationConnections } from '../db/schema/integrationConnections.js';
import { connectorConfigs } from '../db/schema/connectorConfigs.js';
import { connectorConfigService } from '../services/connectorConfigService.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';

const AGENCY_REFRESH_CONCURRENCY = 5;

async function refreshNearExpiryAgencyTokens(): Promise<void> {
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  // connector_configs has FORCE ROW LEVEL SECURITY — use withAdminConnection so
  // this cross-org sweep is not silently filtered to zero rows.
  const nearExpiry = await withAdminConnection(
    { source: 'connector_polling_agency_sweep', skipAudit: true },
    async (adminDb) => {
      await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
      return adminDb
        .select({ id: connectorConfigs.id })
        .from(connectorConfigs)
        .where(
          and(
            eq(connectorConfigs.connectorType, 'ghl'),
            eq(connectorConfigs.tokenScope, 'agency'),
            ne(connectorConfigs.status, 'disconnected'),
            isNotNull(connectorConfigs.expiresAt),
            lt(connectorConfigs.expiresAt, fiveMinFromNow),
          )
        );
    },
  );

  for (let i = 0; i < nearExpiry.length; i += AGENCY_REFRESH_CONCURRENCY) {
    const batch = nearExpiry.slice(i, i + AGENCY_REFRESH_CONCURRENCY);
    await Promise.allSettled(
      batch.map(({ id }) =>
        connectorConfigService.refreshAgencyTokenIfExpired(id).catch((err) => {
          console.error(`[connectorPollingTick] agency token refresh failed for config ${id}:`, err);
        }),
      ),
    );
  }
}

/**
 * Connector Polling Tick — cross-org cron sweep (every minute).
 *
 * Selects integration connections due for sync across all organisations
 * and fan-outs one `connector-polling-sync` job per connection. Uses the
 * raw `db` handle (admin-bypass) because this is a cross-org sweep with
 * no single org context. The per-connection sync job carries the
 * organisationId from the connection row so it runs org-scoped.
 */
export async function runConnectorPollingTick(
  boss: PgBoss,
): Promise<void> {
  await refreshNearExpiryAgencyTokens();

  const connections = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.connectionStatus, 'active'),
        inArray(integrationConnections.syncPhase, ['backfill', 'transition', 'live']),
      ),
    );

  const mapped = connections.map((c) => ({
    id: c.id,
    syncPhase: c.syncPhase as 'backfill' | 'transition' | 'live',
    lastSuccessfulSyncAt: c.lastSuccessfulSyncAt,
    pollIntervalMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
  }));

  const dueIds = selectConnectionsDue(mapped, new Date());

  // Build a lookup for organisationId so each sync job is org-scoped
  const orgById = new Map(connections.map((c) => [c.id, c.organisationId]));

  for (const connectionId of dueIds) {
    const organisationId = orgById.get(connectionId);
    if (!organisationId) continue;

    await boss.send('connector-polling-sync', {
      organisationId,
      connectionId,
    }, {
      singletonKey: `connector-polling-sync-${connectionId}`,
    });
  }
}
