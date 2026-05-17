CREATE TABLE IF NOT EXISTS agent_execution_log_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  edited_by_user_id uuid NOT NULL REFERENCES users(id),
  edit_summary text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_execution_log_edits_run_idx
  ON agent_execution_log_edits (run_id, edited_at DESC);

CREATE INDEX IF NOT EXISTS agent_execution_log_edits_entity_idx
  ON agent_execution_log_edits (entity_type, entity_id, edited_at DESC);

ALTER TABLE agent_execution_log_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_log_edits FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_execution_log_edits_org_isolation
  ON agent_execution_log_edits
  USING (organisation_id = current_setting('app.organisation_id')::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id')::uuid);

-- Note: grants on this table are handled automatically by 0364's
-- ALTER DEFAULT PRIVILEGES (SELECT/INSERT/UPDATE/DELETE on future tables
-- in schema public flow to the `synthetos_app` role). No explicit grant
-- is needed here. An explicit GRANT to `synthetos_app_role` was removed
-- because (a) the role name is `synthetos_app`, not `synthetos_app_role`,
-- and (b) the default-privileges grant already covers it.
