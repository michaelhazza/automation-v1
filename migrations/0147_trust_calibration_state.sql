-- Migration 0147 — agent trust calibration state
--
-- Per (subaccount, agent, domain) trust counter for the S7
-- trust-builds-over-time mechanism. After N consecutive
-- retrospectively-validated auto-applies without override, the agent's
-- auto-threshold is lowered by 0.05 (floor 0.70).
--
-- Spec: docs/memory-and-briefings-spec.md §5.3 (S7)

CREATE TABLE IF NOT EXISTS trust_calibration_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  subaccount_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  /** Optional domain scope — null means org/subaccount-wide. */
  domain text,
  /** Count of consecutive validated auto-applies. Resets on override. */
  consecutive_validated integer NOT NULL DEFAULT 0,
  /** Current auto-threshold for this agent/domain (0.70 floor, 0.85 default). */
  auto_threshold real NOT NULL DEFAULT 0.85,
  /** Window start for the 30-day validation window. */
  window_start_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trust_calibration_state_subaccount_agent_domain_uq
    UNIQUE (subaccount_id, agent_id, domain)
);

CREATE INDEX IF NOT EXISTS trust_calibration_state_org_idx
  ON trust_calibration_state (organisation_id);

-- Row-level security policy
ALTER TABLE trust_calibration_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trust_calibration_state_tenant_isolation ON trust_calibration_state;
CREATE POLICY trust_calibration_state_tenant_isolation ON trust_calibration_state
  USING (organisation_id::text = current_setting('app.organisation_id', true));
