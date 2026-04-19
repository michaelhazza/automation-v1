-- 0174_clientpulse_churn_assessments.sql
-- ClientPulse Phase 3: client_pulse_churn_assessments timeseries table.
-- Keyed on subaccount_id; records risk score + band + drivers per scan cycle.
--
-- Spec: tasks/clientpulse-ghl-gap-analysis.md §9.4, §5.
-- Locked contract (f): re-target skillExecutor.ts:1279 compute_churn_risk
-- handler to write into this table. No parallel handler file.

BEGIN;

CREATE TABLE client_pulse_churn_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  account_id uuid,
  risk_score integer NOT NULL,
  band text NOT NULL,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  intervention_type text,
  config_version text,
  algorithm_version text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_pulse_churn_assessments_risk_score_range_chk
    CHECK (risk_score >= 0 AND risk_score <= 100),
  CONSTRAINT client_pulse_churn_assessments_band_chk
    CHECK (band IN ('healthy', 'watch', 'atRisk', 'critical'))
);

CREATE INDEX client_pulse_churn_assessments_sub_observed_idx
  ON client_pulse_churn_assessments (subaccount_id, observed_at DESC);

CREATE INDEX client_pulse_churn_assessments_org_band_idx
  ON client_pulse_churn_assessments (organisation_id, band, observed_at DESC);

ALTER TABLE client_pulse_churn_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pulse_churn_assessments FORCE ROW LEVEL SECURITY;

CREATE POLICY client_pulse_churn_assessments_writer_bypass ON client_pulse_churn_assessments
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY client_pulse_churn_assessments_read ON client_pulse_churn_assessments
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

COMMIT;
