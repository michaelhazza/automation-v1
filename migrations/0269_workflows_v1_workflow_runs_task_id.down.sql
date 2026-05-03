-- Reverse of 0269_workflows_v1_workflow_runs_task_id.sql

DROP INDEX IF EXISTS workflow_runs_task_id_idx;
ALTER TABLE workflow_runs
  DROP COLUMN IF EXISTS task_id;
