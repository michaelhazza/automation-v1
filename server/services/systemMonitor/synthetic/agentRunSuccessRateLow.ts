import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

const SUCCESS_RATE_METRIC = 'success_rate';
const MIN_SAMPLE_COUNT = 10;
const BASELINE_DROP_THRESHOLD = 0.30;
const LOOKBACK_MS = 60 * 60 * 1000; // 1 hour

export const agentRunSuccessRateLow: SyntheticCheck = {
  id: 'agent-run-success-rate-low',
  description: "A system-managed agent's success rate over the last hour is below baseline minus 30%.",
  defaultSeverity: 'medium',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const since = new Date(ctx.now.getTime() - LOOKBACK_MS);

    const rows = await db.execute<{
      agent_id: string;
      slug: string;
      total: string;
      successes: string;
    }>(sql`
      SELECT
        a.id AS agent_id,
        a.slug,
        COUNT(ar.id)::int AS total,
        COUNT(ar.id) FILTER (WHERE ar.status = 'completed')::int AS successes
      FROM agents a
      JOIN agent_runs ar ON ar.agent_id = a.id
      WHERE a.is_system_managed = true
        AND a.status = 'active'
        AND a.deleted_at IS NULL
        AND ar.created_at >= ${since}
        AND ar.is_test_run = false
      GROUP BY a.id, a.slug
      HAVING COUNT(ar.id) >= 5
    `);

    for (const row of rows) {
      const total = Number(row.total);
      const successes = Number(row.successes);
      const currentRate = total > 0 ? successes / total : 0;

      const baseline = await ctx.baselines.getOrNull('agent', row.slug, SUCCESS_RATE_METRIC, MIN_SAMPLE_COUNT);

      if (!baseline) {
        ctx.logger.info('synthetic-check-skipped-baseline', {
          checkId: 'agent-run-success-rate-low',
          agentSlug: row.slug,
          reason: 'no_baseline',
        });
        continue;
      }

      const floor = baseline.p50 - BASELINE_DROP_THRESHOLD;
      if (currentRate < floor) {
        return {
          fired: true,
          severity: 'medium',
          resourceKind: 'agent',
          resourceId: row.slug,
          summary: `System-managed agent '${row.slug}' success rate (${(currentRate * 100).toFixed(1)}%) is below baseline p50 (${(baseline.p50 * 100).toFixed(1)}%) by more than 30%.`,
          bucketKey: bucket15min(ctx.now),
          metadata: {
            checkId: 'agent-run-success-rate-low',
            agentSlug: row.slug,
            currentRate,
            baselineP50: baseline.p50,
            floor,
            totalRuns: total,
            successfulRuns: successes,
            lookbackMs: LOOKBACK_MS,
          },
        };
      }
    }

    return { fired: false };
  },
};
