-- 0351 down — remove approver_user_id from actions

ALTER TABLE actions
  DROP COLUMN IF EXISTS approver_user_id;
