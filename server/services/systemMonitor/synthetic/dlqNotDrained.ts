import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

const DLQ_STALE_THRESHOLD_MINUTES = Number(process.env.SYSTEM_MONITOR_DLQ_STALE_THRESHOLD_MINUTES) || 30;

export const dlqNotDrained: SyntheticCheck = {
  id: 'dlq-not-drained',
  description: 'The pg-boss DLQ has unhandled failed jobs older than N minutes.',
  defaultSeverity: 'high',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const cutoff = new Date(ctx.now.getTime() - DLQ_STALE_THRESHOLD_MINUTES * 60 * 1000);

    const rows = await db.execute<{ name: string; stale_count: string }>(sql`
      SELECT
        name,
        COUNT(*)::int AS stale_count
      FROM pgboss.job
      WHERE name LIKE '%__dlq'
        AND state = 'failed'
        AND completed_on < ${cutoff}
      GROUP BY name
      HAVING COUNT(*) > 0
      ORDER BY stale_count DESC
      LIMIT 1
    `);

    if (rows.length > 0) {
      const row = rows[0]!;
      const staleCount = Number(row.stale_count);
      return {
        fired: true,
        severity: 'high',
        resourceKind: 'queue',
        resourceId: row.name,
        summary: `DLQ '${row.name}' has ${staleCount} failed job(s) older than ${DLQ_STALE_THRESHOLD_MINUTES} minutes.`,
        bucketKey: bucket15min(ctx.now),
        metadata: {
          checkId: 'dlq-not-drained',
          queueName: row.name,
          staleCount,
          thresholdMinutes: DLQ_STALE_THRESHOLD_MINUTES,
        },
      };
    }

    return { fired: false };
  },
};
