-- Down migration for 0326_operator_session_columns.sql
--
-- Reverses all changes made to integration_connections in 0326.
-- Run this before 0325 down migration.

DROP INDEX IF EXISTS ic_subaccount_operator_session_default_unique;

ALTER TABLE integration_connections
  DROP CONSTRAINT IF EXISTS integration_connections_auth_type_check,
  DROP COLUMN IF EXISTS is_default,
  DROP COLUMN IF EXISTS consent_record_id,
  DROP COLUMN IF EXISTS plan_verified_at,
  DROP COLUMN IF EXISTS plan_verification_status,
  DROP COLUMN IF EXISTS plan_tier,
  DROP COLUMN IF EXISTS usability_state;
