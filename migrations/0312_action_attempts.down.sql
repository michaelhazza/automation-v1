-- 0312_action_attempts.down.sql
-- Reverses migration 0312_action_attempts.sql.

-- Step 1: drop the RLS policy on action_attempts
DROP POLICY IF EXISTS action_attempts_org_isolation ON action_attempts;

-- Step 2: drop the table (all indexes are dropped automatically with the table)
DROP TABLE IF EXISTS action_attempts;
