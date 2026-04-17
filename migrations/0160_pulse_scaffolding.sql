-- 0160_pulse_scaffolding.sql
-- Pulse v1 schema scaffolding: Major-lane thresholds, cost columns,
-- retention override, audit ack columns, failure acknowledgment.
BEGIN;

-- 1. Organisations: Major threshold + default currency
ALTER TABLE organisations
  ADD COLUMN pulse_major_threshold jsonb NULL,
  ADD COLUMN default_currency_code text NOT NULL DEFAULT 'AUD';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_default_currency_code_format_chk
    CHECK (default_currency_code ~ '^[A-Z]{3}$');

-- 2. Actions: estimated cost + subaccount scope
ALTER TABLE actions
  ADD COLUMN estimated_cost_minor integer NULL,
  ADD COLUMN subaccount_scope text NOT NULL DEFAULT 'single';

ALTER TABLE actions
  ADD CONSTRAINT actions_subaccount_scope_chk
    CHECK (subaccount_scope IN ('single', 'multiple'));

ALTER TABLE actions
  ADD CONSTRAINT actions_estimated_cost_minor_nonneg_chk
    CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0);

-- 3. Subaccounts: per-subaccount retention override
ALTER TABLE subaccounts
  ADD COLUMN run_retention_days integer NULL;

ALTER TABLE subaccounts
  ADD CONSTRAINT subaccounts_run_retention_days_range_chk
    CHECK (run_retention_days IS NULL OR (run_retention_days >= 7 AND run_retention_days <= 3650));

-- 4. Review audit records: Major-lane ack columns
ALTER TABLE review_audit_records
  ADD COLUMN major_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN major_reason text NULL,
  ADD COLUMN ack_text text NULL,
  ADD COLUMN ack_amount_minor integer NULL,
  ADD COLUMN ack_currency_code text NULL;

ALTER TABLE review_audit_records
  ADD CONSTRAINT review_audit_records_major_reason_chk
    CHECK (major_reason IS NULL OR major_reason IN (
      'irreversible', 'cross_subaccount', 'cost_per_action', 'cost_per_run'
    ));

ALTER TABLE review_audit_records
  ADD CONSTRAINT review_audit_records_ack_currency_format_chk
    CHECK (ack_currency_code IS NULL OR ack_currency_code ~ '^[A-Z]{3}$');

-- Partial index for the "find Major approvals for audit reporting" query
CREATE INDEX review_audit_records_major_ack_idx
  ON review_audit_records (organisation_id, decided_at DESC)
  WHERE major_acknowledged = true;

-- 5. Agent runs: failure acknowledgment marker
ALTER TABLE agent_runs
  ADD COLUMN failure_acknowledged_at timestamptz NULL;

-- Partial index for "unacknowledged failed runs" Pulse query
CREATE INDEX agent_runs_unack_failed_idx
  ON agent_runs (subaccount_id, created_at DESC)
  WHERE status IN ('failed', 'timeout', 'budget_exceeded', 'loop_detected')
    AND failure_acknowledged_at IS NULL;

-- 6. Drop inbox_read_states (only inboxService reads it; Pulse replaces inbox)
DROP TABLE IF EXISTS inbox_read_states CASCADE;

COMMIT;
