-- Wave 6 Session O: WF1 contingent RLS policies for 5 FK-scoped workflow tables.
-- All five tables have no existing RLS policy (verified 2026-05-17 against main at commit c2b32e4b).
-- Deployed before code changes in this chunk per §7.3 deployment-ordering contract.
--
-- FK column names verified against migration history:
--   workflow_step_runs.run_id            → references workflow_runs (0076, 0221)
--   workflow_step_reviews.step_run_id    → references workflow_step_runs (0076, 0221)
--   workflow_studio_sessions uses created_by_user_id → references users (0076, 0221 renamed from created_by_user_id)
--   workflow_run_event_sequences.run_id  → references workflow_runs (0076, 0221)
--   flow_step_outputs.flow_run_id        → references flow_runs (0219 renamed from workflow_run_id)

-- Enable RLS on all five tables (FORCE RLS prevents even table-owner bypass)
ALTER TABLE workflow_step_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_runs            FORCE ROW LEVEL SECURITY;

ALTER TABLE workflow_step_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_reviews         FORCE ROW LEVEL SECURITY;

ALTER TABLE workflow_studio_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_studio_sessions      FORCE ROW LEVEL SECURITY;

ALTER TABLE workflow_run_event_sequences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_event_sequences  FORCE ROW LEVEL SECURITY;

ALTER TABLE flow_step_outputs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_step_outputs             FORCE ROW LEVEL SECURITY;

-- workflow_step_runs: scoped via parent workflow_runs.organisation_id
CREATE POLICY rls_workflow_step_runs ON workflow_step_runs
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_step_runs.run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_step_runs.run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- workflow_step_reviews: scoped via workflow_step_runs → workflow_runs.organisation_id
CREATE POLICY rls_workflow_step_reviews ON workflow_step_reviews
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_step_runs wsr
      JOIN workflow_runs wr ON wr.id = wsr.run_id
      WHERE wsr.id = workflow_step_reviews.step_run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_step_runs wsr
      JOIN workflow_runs wr ON wr.id = wsr.run_id
      WHERE wsr.id = workflow_step_reviews.step_run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- workflow_studio_sessions: scoped via users.organisation_id
-- The FK column is created_by_user_id (renamed from created_by_user_id in 0221;
-- the original 0076 column was created_by_user_id throughout).
CREATE POLICY rls_workflow_studio_sessions ON workflow_studio_sessions
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = workflow_studio_sessions.created_by_user_id
        AND u.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = workflow_studio_sessions.created_by_user_id
        AND u.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- workflow_run_event_sequences: scoped via workflow_runs.organisation_id
CREATE POLICY rls_workflow_run_event_sequences ON workflow_run_event_sequences
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_run_event_sequences.run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM workflow_runs wr
      WHERE wr.id = workflow_run_event_sequences.run_id
        AND wr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );

-- flow_step_outputs: scoped via flow_runs.organisation_id
-- flow_run_id column was renamed from workflow_run_id in migration 0219.
CREATE POLICY rls_flow_step_outputs ON flow_step_outputs
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM flow_runs fr
      WHERE fr.id = flow_step_outputs.flow_run_id
        AND fr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM flow_runs fr
      WHERE fr.id = flow_step_outputs.flow_run_id
        AND fr.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
