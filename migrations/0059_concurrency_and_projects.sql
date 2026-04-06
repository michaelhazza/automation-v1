-- 0059_concurrency_policies.sql
-- Feature 5: Routine / Heartbeat Concurrency Policies

ALTER TABLE subaccount_agents
  ADD COLUMN concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
  ADD COLUMN catch_up_policy TEXT NOT NULL DEFAULT 'skip_missed',
  ADD COLUMN catch_up_cap INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1;

ALTER TABLE org_agent_configs
  ADD COLUMN concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
  ADD COLUMN catch_up_policy TEXT NOT NULL DEFAULT 'skip_missed',
  ADD COLUMN catch_up_cap INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1;

-- Feature 6: Projects Gap Fixes
ALTER TABLE projects
  ADD COLUMN target_date TIMESTAMPTZ,
  ADD COLUMN budget_cents INTEGER,
  ADD COLUMN budget_warning_percent INTEGER DEFAULT 75;

ALTER TABLE cost_aggregates
  ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX cost_agg_project_idx ON cost_aggregates(project_id);

ALTER TABLE agent_runs
  ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX agent_runs_project_idx ON agent_runs(project_id);
