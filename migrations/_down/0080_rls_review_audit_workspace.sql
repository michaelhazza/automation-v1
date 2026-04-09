-- Down-migration for 0080_rls_review_audit_workspace.sql
-- Drops the RLS policies and disables RLS on the three tables.

DROP POLICY IF EXISTS review_items_org_isolation ON review_items;
ALTER TABLE review_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE review_items DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_audit_records_org_isolation ON review_audit_records;
ALTER TABLE review_audit_records NO FORCE ROW LEVEL SECURITY;
ALTER TABLE review_audit_records DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_memories_org_isolation ON workspace_memories;
ALTER TABLE workspace_memories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_memories DISABLE ROW LEVEL SECURITY;
