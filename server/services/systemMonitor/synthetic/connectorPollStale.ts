import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

const STALE_MULTIPLIER = Number(process.env.SYSTEM_MONITOR_CONNECTOR_STALE_MULTIPLIER) || 3;

export const connectorPollStale: SyntheticCheck = {
  id: 'connector-poll-stale',
  description: 'A connector configured for polling has not reported a successful poll in N minutes.',
  defaultSeverity: 'medium',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const rows = await db.execute<{
      id: string;
      connector_type: string;
      last_sync_at: string | null;
      poll_interval_minutes: number;
    }>(sql`
      SELECT id, connector_type, last_sync_at, poll_interval_minutes
      FROM connector_configs
      WHERE status = 'active'
    `);

    for (const row of rows) {
      const intervalMs = row.poll_interval_minutes * 60 * 1000;
      const cutoff = new Date(ctx.now.getTime() - intervalMs * STALE_MULTIPLIER);
      const lastSyncAt = row.last_sync_at ? new Date(row.last_sync_at) : null;

      if (!lastSyncAt || lastSyncAt < cutoff) {
        const expectedMinutes = row.poll_interval_minutes * STALE_MULTIPLIER;
        return {
          fired: true,
          severity: 'medium',
          resourceKind: 'connector',
          resourceId: row.id,
          summary: lastSyncAt
            ? `Connector '${row.connector_type}' (${row.id}) has not polled successfully in over ${expectedMinutes} minutes (last sync: ${lastSyncAt.toISOString()}).`
            : `Connector '${row.connector_type}' (${row.id}) has no recorded successful polls.`,
          bucketKey: bucket15min(ctx.now),
          metadata: {
            checkId: 'connector-poll-stale',
            connectorId: row.id,
            connectorType: row.connector_type,
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            pollIntervalMinutes: row.poll_interval_minutes,
            staleMultiplier: STALE_MULTIPLIER,
          },
        };
      }
    }

    return { fired: false };
  },
};
