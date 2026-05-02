-- Migration 0267a: Optimiser peer-median materialised view + view metadata table
-- F2 Sub-Account Optimiser — Chunk 2 (Phase 2)
--
-- Creates:
--   1. optimiser_skill_peer_medians — cross-tenant p50/p95/p99 materialised view
--      filtered to event_type='skill.completed', HAVING count(distinct subaccount_id) >= 5
--      so single-tenant data cannot be inferred. Uses skill.completed payload fields
--      skillSlug and durationMs (camelCase, as stored in JSONB by skillExecutor.ts).
--   2. Unique index on skill_slug — required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
--   3. optimiser_view_metadata — single-row sentinel table for staleness detection.
--      Written by refresh_optimiser_peer_medians job after each successful refresh.
--      Read by skillLatency.ts before joining the view (staleness guard per spec §3).
--   4. Composite indexes on source tables for query cost guardrails (AC-22).
--
-- Down migration: 0267a_optimiser_peer_medians.down.sql

-- ---------------------------------------------------------------------------
-- 1. Composite indexes on source tables (AC-22)
--    Added here if they don't exist; each query module relies on them.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS agent_runs_org_started_at_idx
  ON agent_runs (organisation_id, started_at);

CREATE INDEX IF NOT EXISTS agent_execution_events_run_timestamp_idx
  ON agent_execution_events (run_id, event_timestamp);

CREATE INDEX IF NOT EXISTS cost_aggregates_scope_created_at_idx
  ON cost_aggregates (entity_id, updated_at);

CREATE INDEX IF NOT EXISTS memory_citation_scores_run_created_at_idx
  ON memory_citation_scores (run_id, created_at);

CREATE INDEX IF NOT EXISTS fast_path_decisions_subaccount_decided_at_idx
  ON fast_path_decisions (subaccount_id, decided_at);

CREATE INDEX IF NOT EXISTS llm_requests_agent_created_at_idx
  ON llm_requests (run_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Materialised view
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS optimiser_skill_peer_medians AS
SELECT
  payload->>'skillSlug'                                                      AS skill_slug,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (payload->>'durationMs')::int) AS p99_ms,
  count(DISTINCT subaccount_id)                                              AS contributing_subaccount_count
FROM agent_execution_events
WHERE event_type = 'skill.completed'
  AND event_timestamp >= now() - INTERVAL '7 days'
  AND payload->>'skillSlug' IS NOT NULL
  AND payload->>'durationMs' IS NOT NULL
  AND (payload->>'durationMs')::int > 0
GROUP BY payload->>'skillSlug'
HAVING count(DISTINCT subaccount_id) >= 5;

-- ---------------------------------------------------------------------------
-- 3. Unique index — required for REFRESH MATERIALIZED VIEW CONCURRENTLY
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS optimiser_skill_peer_medians_skill_slug_idx
  ON optimiser_skill_peer_medians (skill_slug);

-- ---------------------------------------------------------------------------
-- 4. View metadata table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS optimiser_view_metadata (
  view_name   text        PRIMARY KEY,
  refreshed_at timestamptz NOT NULL
);

COMMENT ON TABLE optimiser_view_metadata IS
  'Staleness sentinel for materialised views. Written by the refresh job after '
  'each successful REFRESH. Read by skillLatency.ts to guard against stale peer data.';
