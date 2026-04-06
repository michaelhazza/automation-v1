-- Intervention Outcomes: effectiveness tracking
CREATE TABLE IF NOT EXISTS intervention_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  intervention_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  intervention_type_slug TEXT NOT NULL,
  trigger_event_id UUID,
  run_id UUID,
  config_version TEXT,
  health_score_before INTEGER,
  health_score_after INTEGER,
  outcome TEXT,
  measured_after_hours INTEGER NOT NULL DEFAULT 24,
  delta_health_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intervention_outcomes_org_idx ON intervention_outcomes (organisation_id);
CREATE INDEX IF NOT EXISTS intervention_outcomes_account_idx ON intervention_outcomes (account_id);
CREATE INDEX IF NOT EXISTS intervention_outcomes_intervention_idx ON intervention_outcomes (intervention_id);

-- Account Overrides: per-account temporary suppressions
CREATE TABLE IF NOT EXISTS account_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  account_id UUID NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE,
  suppress_scoring BOOLEAN NOT NULL DEFAULT false,
  suppress_alerts BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_overrides_org_account_unique
  ON account_overrides (organisation_id, account_id);
CREATE INDEX IF NOT EXISTS account_overrides_expiry_idx ON account_overrides (expires_at);
