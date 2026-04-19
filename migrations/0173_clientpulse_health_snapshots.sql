-- 0173_clientpulse_health_snapshots.sql
-- ClientPulse Phase 2: client_pulse_health_snapshots timeseries table.
-- Keyed on subaccount_id (ClientPulse thinks in terms of sub-accounts, not
-- the generic canonical account_id used by health_snapshots).
--
-- Spec: tasks/clientpulse-ghl-gap-analysis.md §9.4, §4.
-- Locked contract (f): re-target the existing skillExecutor.ts:1269
-- compute_health_score handler to write into this table in addition to the
-- generic health_snapshots (dual-write during deprecation window — the old
-- table has non-ClientPulse readers).

BEGIN;

CREATE TABLE client_pulse_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  account_id uuid,
  score integer NOT NULL,
  factor_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  trend text NOT NULL DEFAULT 'stable',
  confidence double precision NOT NULL DEFAULT 0,
  config_version text,
  algorithm_version text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_pulse_health_snapshots_score_range_chk
    CHECK (score >= 0 AND score <= 100),
  CONSTRAINT client_pulse_health_snapshots_trend_chk
    CHECK (trend IN ('improving', 'stable', 'declining')),
  CONSTRAINT client_pulse_health_snapshots_confidence_chk
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX client_pulse_health_snapshots_sub_observed_idx
  ON client_pulse_health_snapshots (subaccount_id, observed_at DESC);

CREATE INDEX client_pulse_health_snapshots_org_observed_idx
  ON client_pulse_health_snapshots (organisation_id, observed_at DESC);

ALTER TABLE client_pulse_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pulse_health_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY client_pulse_health_snapshots_writer_bypass ON client_pulse_health_snapshots
  FOR ALL TO canonical_writer
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY client_pulse_health_snapshots_read ON client_pulse_health_snapshots
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

COMMIT;
