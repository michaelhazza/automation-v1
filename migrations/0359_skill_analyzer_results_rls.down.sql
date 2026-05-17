-- Down-migration for 0359 — drops the RLS policy and disables row-level
-- security on skill_analyzer_results. Reverses the up exactly.

DROP POLICY IF EXISTS skill_analyzer_results_org_isolation ON skill_analyzer_results;
ALTER TABLE skill_analyzer_results NO FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_analyzer_results DISABLE ROW LEVEL SECURITY;
