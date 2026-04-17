import type PgBoss from 'pg-boss';
import { and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { selectConnectionsDue } from '../services/connectorPollingSchedulerPure.js';
import { DEFAULT_POLL_INTERVAL_MINUTES } from '../config/connectorPollingConfig.js';
import { integrationConnections } from '../db/schema/integrationConnections.js';

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
  const connections = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        inArray(integrationConnections.syncPhase, ['backfill', 'transition', 'live']),
      ),
    );

  const mapped = connections.map((c) => ({
    id: c.id,
    syncPhase: c.syncPhase as 'backfill' | 'transition' | 'live',
    lastSuccessfulSyncAt: c.lastSuccessfulSyncAt,
    pollIntervalMinutes: DEFAULT_POLL_INTERVAL_MINUTES,
    deletedAt: null,
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
