DROP INDEX IF EXISTS agent_runs_backend_task_unique_idx;
DROP INDEX IF EXISTS agent_runs_backend_id_idx;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS backend_task_id;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS backend_id;
ALTER TABLE organisations DROP COLUMN IF EXISTS preferred_backends;
