-- 0354 down — remove substep_status_updated_at from delegation_outcomes
ALTER TABLE delegation_outcomes DROP COLUMN IF EXISTS substep_status_updated_at;
