import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

// Fires when a connector has been in error status with no successful sync for
// over 1 hour — a proxy for "≥3 consecutive errors with no success between them"
// using the data available in connector_configs (no connector_polls table exists yet).
const ERROR_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const connectorErrorRateElevated: SyntheticCheck = {
  id: 'connector-error-rate-elevated',
  description: 'A connector has been in error status with no successful poll in over 1 hour.',
  defaultSeverity: 'high',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const cutoff = new Date(ctx.now.getTime() - ERROR_WINDOW_MS);

    const rows = await db.execute<{
      id: string;
      connector_type: string;
      last_sync_at: string | null;
      last_sync_error: string | null;
      updated_at: string;
    }>(sql`
      SELECT id, connector_type, last_sync_at, last_sync_error, updated_at
      FROM connector_configs
      WHERE status = 'error'
        AND updated_at < ${cutoff}
    `);

    if (rows.length > 0) {
      const row = rows[0]!;
      return {
        fired: true,
        severity: 'high',
        resourceKind: 'connector',
        resourceId: row.id,
        summary: `Connector '${row.connector_type}' (${row.id}) has been in error status for over 1 hour with no successful poll.`,
        bucketKey: bucket15min(ctx.now),
        metadata: {
          checkId: 'connector-error-rate-elevated',
          connectorId: row.id,
          connectorType: row.connector_type,
          lastSyncAt: row.last_sync_at ?? null,
          lastSyncError: row.last_sync_error ?? null,
          errorWindowMs: ERROR_WINDOW_MS,
        },
      };
    }

    return { fired: false };
  },
};
