-- Down migration for 0267a_optimiser_peer_medians.sql
-- Drops the materialised view, index, metadata table, and composite indexes
-- added in the up migration.

-- 4. Drop view metadata
DROP TABLE IF EXISTS optimiser_view_metadata;

-- 3. Drop unique index (dropped implicitly with the view, but explicit for safety)
DROP INDEX IF EXISTS optimiser_skill_peer_medians_skill_slug_idx;

-- 2. Drop materialised view
DROP MATERIALIZED VIEW IF EXISTS optimiser_skill_peer_medians;

-- 1. Drop composite indexes (added in up migration)
DROP INDEX IF EXISTS llm_requests_agent_created_at_idx;
DROP INDEX IF EXISTS fast_path_decisions_subaccount_decided_at_idx;
DROP INDEX IF EXISTS memory_citation_scores_run_created_at_idx;
DROP INDEX IF EXISTS cost_aggregates_scope_created_at_idx;
DROP INDEX IF EXISTS agent_execution_events_run_timestamp_idx;
DROP INDEX IF EXISTS agent_runs_org_started_at_idx;
