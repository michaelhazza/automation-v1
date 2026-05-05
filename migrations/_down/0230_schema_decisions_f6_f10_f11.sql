-- Reversal for migration 0230

ALTER TABLE workflow_runs
  DROP COLUMN IF EXISTS safety_mode;

ALTER TABLE subaccount_agents
  DROP COLUMN IF EXISTS portal_default_safety_mode,
  DROP COLUMN IF EXISTS last_meaningful_tick_at,
  DROP COLUMN IF EXISTS ticks_since_last_meaningful_run;

ALTER TABLE system_skills
  DROP COLUMN IF EXISTS side_effects;
