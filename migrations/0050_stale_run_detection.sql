-- Stale Run Detection (GSD-2 adoption Stage 2)
-- Adds heartbeat columns for detecting dead agent runs.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tool_started_at timestamptz;

-- Index for the cleanup query: find running runs with stale heartbeats
CREATE INDEX IF NOT EXISTS agent_runs_stale_run_idx
  ON agent_runs (status, last_activity_at);
