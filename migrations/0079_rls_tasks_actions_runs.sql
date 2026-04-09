-- 0079_rls_tasks_actions_runs.sql
--
-- Sprint 2 — P1.1 Layer 1: Row Level Security on the three highest-touched
-- tenant-owned tables (tasks, actions, agent_runs).
--
-- Each policy fail-closes when `app.organisation_id` is unset, so any
-- query issued without first running `SELECT set_config('app.organisation_id', $1)`
-- inside the same transaction returns zero rows / rejects all writes.
-- Admin tooling, migrations, and cross-org maintenance jobs must use the
-- `admin_role` session role (BYPASSRLS) via `server/lib/adminDbConnection.ts`.
--
-- Manifest: see server/config/rlsProtectedTables.ts — keep in sync.
-- Contract: see docs/improvements-roadmap-spec.md §P1.1 Layer 1.

-- ---------------------------------------------------------------------------
-- admin_role — BYPASSRLS role used by migrations and admin-bypass tooling.
-- Created idempotently so repeated migration runs do not error.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_role') THEN
    CREATE ROLE admin_role BYPASSRLS NOLOGIN;
  END IF;
END
$$;

-- Grant the role to the current migration runner so it can issue
-- SET LOCAL ROLE admin_role when the application needs cross-org access.
-- The owner of the database is the user executing this migration.
DO $$
BEGIN
  EXECUTE format('GRANT admin_role TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  -- Grant may already exist — ignore duplicate grant errors.
  NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_org_isolation ON tasks;
CREATE POLICY tasks_org_isolation ON tasks
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

-- ---------------------------------------------------------------------------
-- actions
-- ---------------------------------------------------------------------------

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actions_org_isolation ON actions;
CREATE POLICY actions_org_isolation ON actions
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

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;

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
