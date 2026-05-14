-- Down migration for 0237_system_incidents_status_fields.sql
-- Drops the two explicit status columns and their CHECK constraints.

ALTER TABLE system_incidents
  DROP CONSTRAINT IF EXISTS system_incidents_diagnosis_status_enum;

ALTER TABLE system_incidents
  DROP CONSTRAINT IF EXISTS system_incidents_triage_status_enum;

ALTER TABLE system_incidents
  DROP COLUMN IF EXISTS diagnosis_status;

ALTER TABLE system_incidents
  DROP COLUMN IF EXISTS triage_status;
