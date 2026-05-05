DROP POLICY IF EXISTS subaccount_baseline_metrics_org_isolation ON subaccount_baseline_metrics;
ALTER TABLE subaccount_baseline_metrics NO FORCE ROW LEVEL SECURITY;
ALTER TABLE subaccount_baseline_metrics DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subaccount_baselines_org_isolation ON subaccount_baselines;
ALTER TABLE subaccount_baselines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE subaccount_baselines DISABLE ROW LEVEL SECURITY;
