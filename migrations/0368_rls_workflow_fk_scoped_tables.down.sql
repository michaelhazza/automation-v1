DROP POLICY IF EXISTS rls_workflow_step_runs ON workflow_step_runs;
DROP POLICY IF EXISTS rls_workflow_step_reviews ON workflow_step_reviews;
DROP POLICY IF EXISTS rls_workflow_studio_sessions ON workflow_studio_sessions;
DROP POLICY IF EXISTS rls_workflow_run_event_sequences ON workflow_run_event_sequences;
DROP POLICY IF EXISTS rls_flow_step_outputs ON flow_step_outputs;

ALTER TABLE workflow_step_runs            DISABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_reviews         DISABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_studio_sessions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_event_sequences  DISABLE ROW LEVEL SECURITY;
ALTER TABLE flow_step_outputs             DISABLE ROW LEVEL SECURITY;
