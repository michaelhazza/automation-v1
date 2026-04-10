-- 0081_rls_llm_requests_audit.sql
--
-- Sprint 2 — P1.1 Layer 1: RLS on llm_requests, audit_events.
-- See 0079 for the policy shape + fail-closed rationale.
--
-- NOTE: task_activities and task_deliverables RLS is handled by
-- 0091_rls_task_activities_deliverables.sql which adds organisation_id
-- to both tables (denormalised from tasks) and creates the policies.

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

