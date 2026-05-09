DROP INDEX IF EXISTS agent_runs_controller_style_idx;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS controller_style;
