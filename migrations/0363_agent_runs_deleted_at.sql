BEGIN;
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS agent_runs_deleted_at_idx
  ON agent_runs (deleted_at)
  WHERE deleted_at IS NOT NULL;
COMMIT;
