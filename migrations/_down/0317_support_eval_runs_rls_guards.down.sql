-- Down: revert support_eval_runs.org_isolation to the 0315 form (no guards).

DROP POLICY IF EXISTS org_isolation ON support_eval_runs;

CREATE POLICY org_isolation ON support_eval_runs
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
