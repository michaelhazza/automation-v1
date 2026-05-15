BEGIN;

ALTER TABLE sandbox_egress_audit DROP CONSTRAINT IF EXISTS sandbox_egress_audit_subaccount_id_fkey;
ALTER TABLE sandbox_telemetry_events DROP CONSTRAINT IF EXISTS sandbox_telemetry_events_subaccount_id_fkey;
ALTER TABLE sandbox_artefacts DROP CONSTRAINT IF EXISTS sandbox_artefacts_subaccount_id_fkey;
ALTER TABLE sandbox_logs DROP CONSTRAINT IF EXISTS sandbox_logs_subaccount_id_fkey;
ALTER TABLE sandbox_executions DROP CONSTRAINT IF EXISTS sandbox_executions_subaccount_id_fkey;

COMMIT;
