ALTER TABLE agent_runs ADD COLUMN backend_id text;
ALTER TABLE agent_runs ADD COLUMN backend_task_id text;
CREATE INDEX agent_runs_backend_id_idx
  ON agent_runs (backend_id) WHERE backend_id IS NOT NULL;
CREATE UNIQUE INDEX agent_runs_backend_task_unique_idx
  ON agent_runs (backend_id, backend_task_id) WHERE backend_task_id IS NOT NULL;
ALTER TABLE organisations
  ADD COLUMN preferred_backends jsonb NOT NULL DEFAULT '{}'::jsonb;
