-- Down migration for 0322_create_sandbox_artefacts_telemetry_logs.sql
DROP TABLE IF EXISTS sandbox_logs;
DROP TABLE IF EXISTS sandbox_telemetry_events;
DROP TABLE IF EXISTS sandbox_artefacts;
