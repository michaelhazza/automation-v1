-- Down: remove owner_user_id from agents and agent_runs; restore original RLS

-- Restore original agent_runs RLS policy (verbatim from 0079_rls_tasks_actions_runs.sql)
DROP POLICY IF EXISTS agent_runs_org_isolation ON agent_runs;
CREATE POLICY agent_runs_org_isolation ON agent_runs
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

DROP INDEX IF EXISTS integration_connections_owner_unique_idx;
DROP INDEX IF EXISTS agent_runs_user_owned_idx;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS owner_user_id;
DROP INDEX IF EXISTS agents_personal_idx;
ALTER TABLE agents DROP COLUMN IF EXISTS owner_user_id;
