-- Rollback 0334: Remove assigned_user_id from agent_runs

DROP INDEX IF EXISTS agent_runs_assigned_user_id_idx;

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS assigned_user_id;
