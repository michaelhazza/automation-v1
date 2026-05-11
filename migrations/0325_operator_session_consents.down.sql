-- Down migration for 0325_operator_session_consents.sql
--
-- Drops operator_session_consent_events before operator_session_consents
-- to respect FK constraint (consent_events.consent_id → consents.id).
-- Must run before 0326 down migration (which drops consent_record_id FK on
-- integration_connections → operator_session_consents).

DROP TABLE IF EXISTS operator_session_consent_events;
DROP TABLE IF EXISTS operator_session_consents;
