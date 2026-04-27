import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

const DEFAULT_INACTIVITY_THRESHOLD_MINUTES = 120;

function getThresholds(): Record<string, number> {
  try {
    const raw = process.env.SYSTEM_MONITOR_AGENT_INACTIVITY_THRESHOLDS_JSON;
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const noAgentRunsInWindow: SyntheticCheck = {
  id: 'no-agent-runs-in-window',
  description: 'A system-managed agent has not run in N minutes despite being scheduled / on-demand-eligible.',
  defaultSeverity: 'medium',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const thresholds = getThresholds();

    const rows = await db.execute<{ slug: string; last_run_at: string | null }>(sql`
      SELECT
        a.slug,
        MAX(ar.created_at) AS last_run_at
      FROM agents a
      LEFT JOIN agent_runs ar ON ar.agent_id = a.id
      WHERE a.is_system_managed = true
        AND a.status = 'active'
        AND a.deleted_at IS NULL
      GROUP BY a.slug
    `);

    for (const row of rows) {
      const thresholdMinutes = thresholds[row.slug] ?? DEFAULT_INACTIVITY_THRESHOLD_MINUTES;
      const cutoff = new Date(ctx.now.getTime() - thresholdMinutes * 60 * 1000);
      const lastRunAt = row.last_run_at ? new Date(row.last_run_at) : null;

      if (!lastRunAt || lastRunAt < cutoff) {
        return {
          fired: true,
          severity: 'medium',
          resourceKind: 'agent',
          resourceId: row.slug,
          summary: lastRunAt
            ? `System-managed agent '${row.slug}' has not run in over ${thresholdMinutes} minutes (last run: ${lastRunAt.toISOString()}).`
            : `System-managed agent '${row.slug}' has no recorded runs.`,
          bucketKey: bucket15min(ctx.now),
          metadata: {
            checkId: 'no-agent-runs-in-window',
            agentSlug: row.slug,
            lastRunAt: lastRunAt?.toISOString() ?? null,
            thresholdMinutes,
          },
        };
      }
    }

    return { fired: false };
  },
};
