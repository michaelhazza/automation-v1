-- Migration 0359: Enable RLS on skill_analyzer_results (Track A3 SA1)
--
-- skill_analyzer_results has no direct organisation_id column. Tenant
-- isolation is achieved via the parent-EXISTS pattern against
-- skill_analyzer_jobs.organisation_id — the FK column (job_id) cascades on
-- DELETE so orphaned rows are not a concern.
--
-- All routes touching skill_analyzer are gated system-admin-only today, so
-- the practical cross-tenant exposure window has been narrow; this policy
-- closes the layer-1 hole regardless.
--
-- See architecture.md § Canonical org-isolation policy template — this
-- migration adapts the template to the parent-EXISTS shape because the row
-- itself does not carry organisation_id.

ALTER TABLE skill_analyzer_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_analyzer_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_analyzer_results_org_isolation ON skill_analyzer_results;

CREATE POLICY skill_analyzer_results_org_isolation ON skill_analyzer_results
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM skill_analyzer_jobs saj
      WHERE saj.id = skill_analyzer_results.job_id
        AND saj.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM skill_analyzer_jobs saj
      WHERE saj.id = skill_analyzer_results.job_id
        AND saj.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
