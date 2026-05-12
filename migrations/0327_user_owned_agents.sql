-- User-owned agents foundation primitives
-- Adds owner_user_id to agents and agent_runs; partial indexes; RLS extension

-- 1. agents: owner_user_id column
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

-- 2. Partial index: (organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL
CREATE INDEX IF NOT EXISTS agents_personal_idx
  ON agents(organisation_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- 3. agent_runs: owner_user_id column (immutable once set — no FK, copied from agent at run start)
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- 4. Partial index on agent_runs for user-owned activity views
CREATE INDEX IF NOT EXISTS agent_runs_user_owned_idx
  ON agent_runs(organisation_id, owner_user_id, started_at DESC)
  WHERE owner_user_id IS NOT NULL;

-- 5. Partial unique index on integration_connections for owner-scoped lookup
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_owner_unique_idx
  ON integration_connections(organisation_id, subaccount_id, owner_user_id, provider_type)
  WHERE owner_user_id IS NOT NULL;

-- 6. Extend agent_runs_org_isolation to allow users to see only their own user-owned runs
-- (owner_user_id IS NULL = subaccount-owned, visible to all org members as before)
DROP POLICY IF EXISTS agent_runs_org_isolation ON agent_runs;
CREATE POLICY agent_runs_org_isolation ON agent_runs
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      owner_user_id IS NULL
      OR current_setting('app.current_role', true) IN ('org_admin', 'system_admin', 'subaccount_admin')
      OR (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) <> ''
        AND owner_user_id = current_setting('app.current_user_id', true)::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
