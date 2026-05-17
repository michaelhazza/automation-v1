-- Down migration for 0326_operator_session_columns.sql
--
-- Reverses all changes made to integration_connections in 0326.
-- Run this BEFORE 0325 down migration (this file drops the FK column pointing
-- into operator_session_consents; 0325.down then drops the referenced table).

-- OSI-DEF-5: surface out-of-order rollback. If consents are already gone the
-- 0325.down has been run first; the FK drop below still works but the order
-- contract has been broken — emit a NOTICE so the irregularity is visible.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'operator_session_consents'
  ) THEN
    RAISE NOTICE '0326 down-migration: operator_session_consents already absent; 0325.down ran first. Order contract broken but continuing.';
  END IF;
END $$;

DROP INDEX IF EXISTS ic_subaccount_operator_session_default_unique;

ALTER TABLE integration_connections
  DROP CONSTRAINT IF EXISTS integration_connections_auth_type_check,
  DROP COLUMN IF EXISTS is_default,
  DROP COLUMN IF EXISTS consent_record_id,
  DROP COLUMN IF EXISTS plan_verified_at,
  DROP COLUMN IF EXISTS plan_verification_status,
  DROP COLUMN IF EXISTS plan_tier,
  DROP COLUMN IF EXISTS usability_state;
