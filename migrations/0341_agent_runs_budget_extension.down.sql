-- Rollback 0341: Remove per_task_budget_extension_minutes from agent_runs
ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS per_task_budget_extension_minutes;
