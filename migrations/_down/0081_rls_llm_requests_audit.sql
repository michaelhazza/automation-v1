-- Down-migration for 0081_rls_llm_requests_audit.sql
-- Drops the RLS policies and disables RLS on the four tables.

DROP POLICY IF EXISTS llm_requests_org_isolation ON llm_requests;
ALTER TABLE llm_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE llm_requests DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_org_isolation ON audit_events;
ALTER TABLE audit_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_activities_org_isolation ON task_activities;
ALTER TABLE task_activities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE task_activities DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_deliverables_org_isolation ON task_deliverables;
ALTER TABLE task_deliverables NO FORCE ROW LEVEL SECURITY;
ALTER TABLE task_deliverables DISABLE ROW LEVEL SECURITY;
