ALTER TABLE agent_runs
  ADD COLUMN delegation_scope text,
  ADD COLUMN hierarchy_depth smallint,
  ADD COLUMN delegation_direction text,
  ADD COLUMN handoff_source_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_delegation_scope_chk
  CHECK (delegation_scope IS NULL OR delegation_scope IN ('children', 'descendants', 'subaccount')),
  ADD CONSTRAINT agent_runs_delegation_direction_chk
  CHECK (delegation_direction IS NULL OR delegation_direction IN ('down', 'up', 'lateral'));

CREATE INDEX agent_runs_hierarchy_depth_idx ON agent_runs (hierarchy_depth)
  WHERE hierarchy_depth IS NOT NULL;

CREATE INDEX agent_runs_handoff_source_run_id_idx ON agent_runs (handoff_source_run_id)
  WHERE handoff_source_run_id IS NOT NULL;
