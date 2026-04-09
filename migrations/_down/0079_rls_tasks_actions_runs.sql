-- Down-migration for 0079_rls_tasks_actions_runs.sql
-- Drops the RLS policies and disables RLS on the three tables. The
-- admin_role BYPASSRLS role is left in place — other migrations may depend
-- on it. Drop it manually if fully reverting Sprint 2.

DROP POLICY IF EXISTS tasks_org_isolation ON tasks;
ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS actions_org_isolation ON actions;
ALTER TABLE actions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_runs_org_isolation ON agent_runs;
ALTER TABLE agent_runs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_runs DISABLE ROW LEVEL SECURITY;
