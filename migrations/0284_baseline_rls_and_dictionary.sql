-- F3 §3 — RLS for both new tables.
ALTER TABLE subaccount_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_baselines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subaccount_baselines_org_isolation ON subaccount_baselines;
CREATE POLICY subaccount_baselines_org_isolation ON subaccount_baselines
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

-- subaccount_baseline_metrics is keyed off baseline_id (no organisation_id column).
-- Policy walks the FK to subaccount_baselines.
ALTER TABLE subaccount_baseline_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_baseline_metrics FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subaccount_baseline_metrics_org_isolation ON subaccount_baseline_metrics;
CREATE POLICY subaccount_baseline_metrics_org_isolation ON subaccount_baseline_metrics
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM subaccount_baselines sb
      WHERE sb.id = subaccount_baseline_metrics.baseline_id
        AND sb.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM subaccount_baselines sb
      WHERE sb.id = subaccount_baseline_metrics.baseline_id
        AND sb.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
