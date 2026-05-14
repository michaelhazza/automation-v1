-- 0353 down — drop operator_run_files table (CASCADE drops the policy + indexes)

DROP TABLE IF EXISTS operator_run_files CASCADE;
