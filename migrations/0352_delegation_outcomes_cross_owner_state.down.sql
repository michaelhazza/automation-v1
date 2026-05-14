-- 0352 down — remove cross-owner state-machine columns from delegation_outcomes

DROP INDEX IF EXISTS delegation_outcomes_open_substeps_idx;

ALTER TABLE delegation_outcomes
  DROP COLUMN IF EXISTS terminal_at;

ALTER TABLE delegation_outcomes
  DROP COLUMN IF EXISTS substep_status;

ALTER TABLE delegation_outcomes
  DROP COLUMN IF EXISTS cross_owner_approval_timeout_policy;
