-- 0081_rls_llm_requests_audit.sql
--
-- Sprint 2 — P1.1 Layer 1: RLS on llm_requests, audit_events,
-- task_activities, task_deliverables. See 0079 for the policy shape +
-- fail-closed rationale.

-- ---------------------------------------------------------------------------
-- llm_requests
-- ---------------------------------------------------------------------------

ALTER TABLE llm_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_requests_org_isolation ON llm_requests;
CREATE POLICY llm_requests_org_isolation ON llm_requests
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
-- audit_events
-- ---------------------------------------------------------------------------

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_org_isolation ON audit_events;
CREATE POLICY audit_events_org_isolation ON audit_events
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
-- task_activities
-- ---------------------------------------------------------------------------

ALTER TABLE task_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_activities_org_isolation ON task_activities;
CREATE POLICY task_activities_org_isolation ON task_activities
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
-- task_deliverables
-- ---------------------------------------------------------------------------

ALTER TABLE task_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_deliverables FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_deliverables_org_isolation ON task_deliverables;
CREATE POLICY task_deliverables_org_isolation ON task_deliverables
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
