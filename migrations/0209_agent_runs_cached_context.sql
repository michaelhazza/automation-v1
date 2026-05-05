-- Migration 0209: agent_runs cached context columns (§5.8)
-- Adds run-outcome classification and bundle-snapshot tracking.

ALTER TABLE agent_runs ADD COLUMN bundle_snapshot_ids jsonb;
ALTER TABLE agent_runs ADD COLUMN variable_input_hash text;
ALTER TABLE agent_runs ADD COLUMN run_outcome text;
ALTER TABLE agent_runs ADD COLUMN soft_warn_tripped boolean NOT NULL DEFAULT false;
ALTER TABLE agent_runs ADD COLUMN degraded_reason text;

-- Partial index for dashboard queries filtering on run_outcome
CREATE INDEX agent_runs_run_outcome_idx ON agent_runs (run_outcome)
  WHERE run_outcome IS NOT NULL;

-- Partial index for degradation-category dashboard queries
CREATE INDEX agent_runs_degraded_reason_idx ON agent_runs (degraded_reason)
  WHERE degraded_reason IS NOT NULL;
