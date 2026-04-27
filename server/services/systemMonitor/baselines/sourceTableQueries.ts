// ---------------------------------------------------------------------------
// Baseline source-table aggregate queries.
//
// Each function queries one source table and returns pre-aggregated stats
// per (entity_kind, entity_id, metric_name) using Postgres window functions.
// These are READ-ONLY against tenant tables. All writes happen in refreshJob.ts.
//
// Currently implemented: agent_runs (metrics: runtime_ms, token_count_input,
// token_count_output). Stubs for skill_executions, connector_polls,
// llm_router_calls — those tables do not exist yet; implementations land
// when the tables ship.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../../../db/index.js';
import type { BaselineEntityKind } from '../heuristics/types.js';

export interface AggregateRow {
  entityKind: BaselineEntityKind;
  entityId: string;
  metricName: string;
  sampleCount: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  entityChangeMarker: string | null;
}

/**
 * Aggregates per-agent stats from agent_runs over the last `windowDays` days.
 *
 * Metrics produced: runtime_ms, token_count_input, token_count_output.
 * entity_id = agents.slug (per spec §7.1).
 * entity_change_marker = agents.config_hash (detects prompt / model drift per §7.6).
 *
 * Runs under an admin-bypass transaction (caller has already set admin_role).
 */
export async function aggregateAgentRuns(
  tx: OrgScopedTx,
  windowDays: number,
): Promise<AggregateRow[]> {
  const rows = await tx.execute<{
    entity_id: string;
    metric_name: string;
    sample_count: string;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    mean: string | null;
    stddev: string | null;
    min: string | null;
    max: string | null;
    entity_change_marker: string | null;
  }>(sql`
    WITH runs AS (
      SELECT
        a.slug                     AS entity_id,
        a.config_hash              AS entity_change_marker,
        ar.duration_ms,
        ar.input_tokens,
        ar.output_tokens,
        ar.run_result_status
      FROM agent_runs ar
      JOIN agents a ON a.id = ar.agent_id
      WHERE ar.completed_at > NOW() - (${windowDays} || ' days')::interval
        AND ar.status IN ('completed', 'failed', 'timeout', 'loop_detected', 'budget_exceeded')
        AND ar.is_test_run = false
    )
    SELECT
      entity_id,
      metric_name,
      entity_change_marker,
      COUNT(*) FILTER (WHERE value IS NOT NULL) AS sample_count,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY value) AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) AS p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value) AS p99,
      AVG(value)                                           AS mean,
      STDDEV(value)                                        AS stddev,
      MIN(value)                                           AS min,
      MAX(value)                                           AS max
    FROM (
      SELECT entity_id, entity_change_marker, 'runtime_ms'         AS metric_name, duration_ms::numeric    AS value FROM runs
      UNION ALL
      SELECT entity_id, entity_change_marker, 'token_count_input'  AS metric_name, input_tokens::numeric   AS value FROM runs
      UNION ALL
      SELECT entity_id, entity_change_marker, 'token_count_output' AS metric_name, output_tokens::numeric  AS value FROM runs
      UNION ALL
      -- success_rate: 1 if run_result_status='success', 0 otherwise (per Phase 2.5 §9.6)
      SELECT entity_id, entity_change_marker, 'success_rate'       AS metric_name,
             CASE WHEN run_result_status = 'success' THEN 1.0 ELSE 0.0 END AS value FROM runs
      UNION ALL
      -- cost_per_outcome: total tokens on successful runs (tokens_per_successful_run per Phase 2.5 §9.6)
      SELECT entity_id, entity_change_marker, 'cost_per_outcome'   AS metric_name,
             (input_tokens + output_tokens)::numeric AS value FROM runs WHERE run_result_status = 'success'
    ) unpivoted
    WHERE value IS NOT NULL
    GROUP BY entity_id, entity_change_marker, metric_name
    HAVING COUNT(*) FILTER (WHERE value IS NOT NULL) > 0
  `);

  return rows.map(row => ({
    entityKind: 'agent' as const,
    entityId: row.entity_id,
    metricName: row.metric_name,
    sampleCount: Number(row.sample_count),
    p50: Number(row.p50),
    p95: Number(row.p95),
    p99: Number(row.p99),
    mean: Number(row.mean),
    stddev: Number(row.stddev ?? 0),
    min: Number(row.min),
    max: Number(row.max),
    entityChangeMarker: row.entity_change_marker ?? null,
  }));
}

/**
 * Stub — skill_executions table not yet present in the codebase.
 * Implement when the table ships.
 */
export async function aggregateSkillExecutions(
  _tx: OrgScopedTx,
  _windowDays: number,
): Promise<AggregateRow[]> {
  return [];
}

/**
 * Stub — connector_polls table not yet present in the codebase.
 * Implement when the table ships.
 */
export async function aggregateConnectorPolls(
  _tx: OrgScopedTx,
  _windowDays: number,
): Promise<AggregateRow[]> {
  return [];
}

/**
 * Stub — llm_router_calls table not yet present in the codebase.
 * Implement when the table ships.
 */
export async function aggregateLlmRouterCalls(
  _tx: OrgScopedTx,
  _windowDays: number,
): Promise<AggregateRow[]> {
  return [];
}
