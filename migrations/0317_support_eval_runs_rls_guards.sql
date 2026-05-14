-- Corrective migration: align support_eval_runs.org_isolation policy with the
-- canonical RLS template (architecture.md § RLS — fail-closed when the GUC is
-- unset OR set to an empty string).
--
-- Migration 0315's policy reads
--   USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
-- which throws a Postgres invalid-uuid error when the GUC is set to '' instead
-- of evaluating to FALSE. The canonical pattern adds explicit
--   IS NOT NULL AND <> ''
-- guards so the policy short-circuits to FALSE on missing-context paths. Match
-- the rest of the org-isolated tables (run_artifacts in 0313 already correct).

DROP POLICY IF EXISTS org_isolation ON support_eval_runs;

CREATE POLICY org_isolation ON support_eval_runs
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
