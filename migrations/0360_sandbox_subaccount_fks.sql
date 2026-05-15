BEGIN;

ALTER TABLE sandbox_executions ADD CONSTRAINT sandbox_executions_subaccount_id_fkey FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT;
ALTER TABLE sandbox_logs ADD CONSTRAINT sandbox_logs_subaccount_id_fkey FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT;
ALTER TABLE sandbox_artefacts ADD CONSTRAINT sandbox_artefacts_subaccount_id_fkey FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT;
ALTER TABLE sandbox_telemetry_events ADD CONSTRAINT sandbox_telemetry_events_subaccount_id_fkey FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT;
ALTER TABLE sandbox_egress_audit ADD CONSTRAINT sandbox_egress_audit_subaccount_id_fkey FOREIGN KEY (subaccount_id) REFERENCES subaccounts(id) ON DELETE RESTRICT;

COMMIT;
