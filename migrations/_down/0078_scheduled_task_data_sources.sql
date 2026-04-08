-- Reverse 0078_scheduled_task_data_sources.sql

ALTER TABLE agent_runs DROP COLUMN IF EXISTS context_sources_snapshot;

DROP INDEX IF EXISTS agent_data_sources_unique_per_scope_idx;
DROP INDEX IF EXISTS agent_data_sources_scheduled_task_idx;

ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_scope_exclusive_check;
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_loading_mode_check;

ALTER TABLE agent_data_sources DROP COLUMN IF EXISTS loading_mode;
ALTER TABLE agent_data_sources DROP COLUMN IF EXISTS scheduled_task_id;
