-- Workflows V1: add task_id to workflow_runs (Chunk 9 F1)
--
-- Nullable FK → tasks(id). Existing rows have no task context.
-- task_id is populated at run creation when the run is spawned
-- from a task (e.g. triggered by an orchestrator that owns a task).
-- No new RLS policy needed — workflow_runs already has org-isolation RLS.

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id);

CREATE INDEX IF NOT EXISTS workflow_runs_task_id_idx
  ON workflow_runs (task_id)
  WHERE task_id IS NOT NULL;
