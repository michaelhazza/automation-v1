// ---------------------------------------------------------------------------
// Baseline refresh job — runs the aggregate queries and UPSERTs results.
//
// Called by server/jobs/systemMonitorBaselineRefreshJob.ts (the pg-boss entry
// point). Wrapped in withSystemPrincipal at the entry-point level.
//
// RLS note: cross-tenant reads via withAdminConnectionGuarded.
// system_monitor_baselines intentionally bypasses RLS (allowlisted).
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { logger } from '../../../lib/logger.js';
import {
  aggregateAgentRuns,
  aggregateSkillExecutions,
  aggregateConnectorPolls,
  aggregateLlmRouterCalls,
} from './sourceTableQueries.js';

const BASELINE_WINDOW_DAYS =
  Number(process.env.SYSTEM_MONITOR_BASELINE_WINDOW_DAYS) || 7;

export async function runBaselineRefresh(): Promise<void> {
  if (process.env.SYSTEM_MONITOR_BASELINE_REFRESH_ENABLED === 'false') {
    logger.info('baseline_refresh_disabled');
    return;
  }

  logger.info('baseline_refresh_start', { windowDays: BASELINE_WINDOW_DAYS });

  const started = Date.now();

  await withAdminConnectionGuarded(
    {
      source: 'system_monitor_baseline_refresh',
      // allowRlsBypass: cross-tenant aggregate reads against agent_runs / agents.
      // system_monitor_baselines itself bypasses RLS (see rls-not-applicable-allowlist.txt).
      allowRlsBypass: true,
      reason: 'cross-tenant aggregate for system-scoped baseline refresh',
    },
    async (tx) => {
      // Must explicitly switch to admin_role to bypass RLS on tenant tables.
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const [agentRows, skillRows, connectorRows, llmRows] = await Promise.all([
        aggregateAgentRuns(tx, BASELINE_WINDOW_DAYS),
        aggregateSkillExecutions(tx, BASELINE_WINDOW_DAYS),
        aggregateConnectorPolls(tx, BASELINE_WINDOW_DAYS),
        aggregateLlmRouterCalls(tx, BASELINE_WINDOW_DAYS),
      ]);

      const allRows = [...agentRows, ...skillRows, ...connectorRows, ...llmRows];

      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      let upserted = 0;
      let driftResets = 0;

      for (const row of allRows) {
        // Detect entity drift: if the entity_change_marker has changed since
        // the last baseline row, reset by overwriting with the fresh stats.
        // Per spec §7.6 — stale baselines under a changed entity config
        // cause false-positive heuristic fires.
        const existing = await tx.execute<{ entity_change_marker: string | null }>(sql`
          SELECT entity_change_marker
          FROM system_monitor_baselines
          WHERE entity_kind = ${row.entityKind}
            AND entity_id   = ${row.entityId}
            AND metric_name = ${row.metricName}
          LIMIT 1
        `);

        const priorMarker = existing[0]?.entity_change_marker ?? null;
        if (priorMarker !== null && row.entityChangeMarker !== null && priorMarker !== row.entityChangeMarker) {
          driftResets++;
          logger.info('baseline_drift_reset', {
            entityKind: row.entityKind,
            entityId: row.entityId,
            metricName: row.metricName,
            priorMarker,
            newMarker: row.entityChangeMarker,
          });
        }

        await tx.execute(sql`
          INSERT INTO system_monitor_baselines (
            entity_kind, entity_id, metric_name,
            window_start, window_end, sample_count,
            p50, p95, p99, mean, stddev, min, max,
            entity_change_marker, created_at, updated_at
          ) VALUES (
            ${row.entityKind}, ${row.entityId}, ${row.metricName},
            ${windowStart}, ${windowEnd}, ${row.sampleCount},
            ${row.p50}, ${row.p95}, ${row.p99},
            ${row.mean}, ${row.stddev}, ${row.min}, ${row.max},
            ${row.entityChangeMarker ?? null},
            now(), now()
          )
          ON CONFLICT (entity_kind, entity_id, metric_name)
          DO UPDATE SET
            window_start          = EXCLUDED.window_start,
            window_end            = EXCLUDED.window_end,
            sample_count          = EXCLUDED.sample_count,
            p50                   = EXCLUDED.p50,
            p95                   = EXCLUDED.p95,
            p99                   = EXCLUDED.p99,
            mean                  = EXCLUDED.mean,
            stddev                = EXCLUDED.stddev,
            min                   = EXCLUDED.min,
            max                   = EXCLUDED.max,
            entity_change_marker  = EXCLUDED.entity_change_marker,
            updated_at            = now()
        `);
        upserted++;
      }

      logger.info('baseline_refresh_complete', {
        windowDays: BASELINE_WINDOW_DAYS,
        totalRows: allRows.length,
        upserted,
        driftResets,
        durationMs: Date.now() - started,
      });
    },
  );
}
