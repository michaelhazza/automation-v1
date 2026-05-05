import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';
import { isQueueStalled } from './syntheticChecksPure.js';

const STALL_THRESHOLD_MINUTES = Number(process.env.SYSTEM_MONITOR_QUEUE_STALL_THRESHOLD_MINUTES) || 5;

export const pgBossQueueStalled: SyntheticCheck = {
  id: 'pg-boss-queue-stalled',
  description: 'A pg-boss queue has pending jobs but has not completed a job within the stall threshold.',
  defaultSeverity: 'high',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const rows = await db.execute<{ name: string; pending: string; last_completed_at: string | null }>(sql`
      SELECT
        name,
        COUNT(*) FILTER (WHERE state = 'created')::int AS pending,
        MAX(started_on) FILTER (WHERE state = 'completed') AS last_completed_at
      FROM pgboss.job
      WHERE state IN ('created', 'completed')
        AND name NOT LIKE '%__dlq'
      GROUP BY name
      HAVING COUNT(*) FILTER (WHERE state = 'created') > 0
    `);

    for (const row of rows) {
      const pending = Number(row.pending);
      const lastCompleted = row.last_completed_at ? new Date(row.last_completed_at) : null;

      if (isQueueStalled(pending, lastCompleted, ctx.now, STALL_THRESHOLD_MINUTES)) {
        return {
          fired: true,
          severity: 'high',
          resourceKind: 'queue',
          resourceId: row.name,
          summary: `Queue '${row.name}' has ${pending} pending job(s) but no completion in the last ${STALL_THRESHOLD_MINUTES} minutes.`,
          bucketKey: bucket15min(ctx.now),
          metadata: {
            checkId: 'pg-boss-queue-stalled',
            queueName: row.name,
            pendingCount: pending,
            lastCompletedAt: lastCompleted?.toISOString() ?? null,
            stallThresholdMinutes: STALL_THRESHOLD_MINUTES,
          },
        };
      }
    }

    return { fired: false };
  },
};
