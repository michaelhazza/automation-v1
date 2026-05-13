-- 0349 down — remove owner_user_id and subaccount_id from operator_run_files
ALTER TABLE operator_run_files DROP COLUMN IF EXISTS owner_user_id;
ALTER TABLE operator_run_files DROP COLUMN IF EXISTS subaccount_id;
