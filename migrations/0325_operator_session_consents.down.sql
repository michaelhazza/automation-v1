-- Down migration for 0325_operator_session_consents.sql
--
-- Drops operator_session_consent_events before operator_session_consents
-- to respect FK constraint (consent_events.consent_id → consents.id).
-- Must run AFTER 0326 down migration (which drops the consent_record_id FK on
-- integration_connections → operator_session_consents).

-- OSI-DEF-5: explicit ordering guard. Fail fast if 0326.down has not yet
-- removed the FK column on integration_connections, since DROP TABLE
-- operator_session_consents below would otherwise raise an opaque FK error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'integration_connections'
      AND column_name = 'consent_record_id'
  ) THEN
    RAISE EXCEPTION '0325 down-migration ordering violation: integration_connections.consent_record_id still exists; run 0326.down first.';
  END IF;
END $$;

DROP TABLE IF EXISTS operator_session_consent_events;
DROP TABLE IF EXISTS operator_session_consents;
