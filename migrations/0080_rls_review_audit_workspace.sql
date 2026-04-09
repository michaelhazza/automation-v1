-- 0080_rls_review_audit_workspace.sql
--
-- Sprint 2 — P1.1 Layer 1: RLS on review_items, review_audit_records,
-- workspace_memories. See 0079 for the policy shape + fail-closed rationale.

-- ---------------------------------------------------------------------------
-- review_items
-- ---------------------------------------------------------------------------

ALTER TABLE review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_items_org_isolation ON review_items;
CREATE POLICY review_items_org_isolation ON review_items
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
-- review_audit_records
-- ---------------------------------------------------------------------------

ALTER TABLE review_audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_audit_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_audit_records_org_isolation ON review_audit_records;
CREATE POLICY review_audit_records_org_isolation ON review_audit_records
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
-- workspace_memories
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_memories_org_isolation ON workspace_memories;
CREATE POLICY workspace_memories_org_isolation ON workspace_memories
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
