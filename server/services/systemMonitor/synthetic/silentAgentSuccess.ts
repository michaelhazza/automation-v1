import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';
import {
  SILENT_AGENT_SUCCESS_LOOKBACK_MS,
  isSilentAgentRatioElevated,
  parseMinSamplesEnv,
  parseRatioThresholdEnv,
} from './silentAgentSuccessPure.js';

export { isSilentAgentRatioElevated } from './silentAgentSuccessPure.js';

export const silentAgentSuccess: SyntheticCheck = {
  id: 'silent-agent-success',
  description: "A system-managed agent completed ≥30% of its runs in the last hour with no observable side effects (no agent_execution_events rows AND no system_incident_events rows authored by the run).",
  defaultSeverity: 'medium',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const since = new Date(ctx.now.getTime() - SILENT_AGENT_SUCCESS_LOOKBACK_MS);
    const minSamples = parseMinSamplesEnv();
    const ratioThreshold = parseRatioThresholdEnv();

    const rows = await db.execute<{
      slug: string;
      total_completed: string;
      silent_count: string;
    }>(sql`
      SELECT
        a.slug,
        COUNT(ar.id)::int AS total_completed,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (SELECT 1 FROM agent_execution_events ae WHERE ae.run_id = ar.id)
            AND NOT EXISTS (SELECT 1 FROM system_incident_events sie WHERE sie.actor_agent_run_id = ar.id)
        )::int AS silent_count
      FROM agents a
      JOIN agent_runs ar ON ar.agent_id = a.id
      WHERE a.is_system_managed = true
        AND a.status = 'active'
        AND a.deleted_at IS NULL
        AND ar.status = 'completed'
        AND ar.is_test_run = false
        AND ar.created_at >= ${since}
      GROUP BY a.slug
      HAVING COUNT(ar.id) >= ${minSamples}
    `);

    for (const row of rows) {
      const total = Number(row.total_completed);
      const silent = Number(row.silent_count);

      if (!isSilentAgentRatioElevated(total, silent, ratioThreshold, minSamples)) continue;

      // First-fire-wins: return on the first offending agent.
      const pct = total > 0 ? Math.round((silent / total) * 100) : 0;
      return {
        fired: true,
        severity: 'medium',
        resourceKind: 'agent',
        resourceId: row.slug,
        summary: `Agent '${row.slug}' completed ${total} runs in the last hour with no observable side effects (${pct}% silent).`,
        bucketKey: bucket15min(ctx.now),
        metadata: {
          checkId: 'silent-agent-success',
          agentSlug: row.slug,
          totalCompleted: total,
          silentCount: silent,
          ratio: total > 0 ? silent / total : 0,
          lookbackMs: SILENT_AGENT_SUCCESS_LOOKBACK_MS,
        },
      };
    }

    return { fired: false };
  },
};
