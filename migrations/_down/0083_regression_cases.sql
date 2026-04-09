-- Down-migration for 0083_regression_cases.sql

DROP POLICY IF EXISTS regression_cases_org_isolation ON regression_cases;
ALTER TABLE regression_cases NO FORCE ROW LEVEL SECURITY;
ALTER TABLE regression_cases DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS regression_cases_call_hash_idx;
DROP INDEX IF EXISTS regression_cases_source_run_idx;
DROP INDEX IF EXISTS regression_cases_org_idx;
DROP INDEX IF EXISTS regression_cases_agent_status_idx;

DROP TABLE IF EXISTS regression_cases;

ALTER TABLE agents
  DROP COLUMN IF EXISTS regression_case_cap;
