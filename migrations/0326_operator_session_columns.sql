-- Migration 0326: Operator Session Identity — integration_connections columns
--
-- Adds 6 new columns to integration_connections for operator-session auth type
-- support: usability_state, plan_tier, plan_verification_status, plan_verified_at,
-- consent_record_id (FK → operator_session_consents), and is_default.
--
-- Also adds a partial unique index for the one-default-per-subaccount invariant,
-- and the auth_type CHECK constraint (no prior constraint exists — verified by
-- grepping all migrations).
--
-- Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §7.3, §7.4, §8.3, §8.4

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS usability_state          text,
  ADD COLUMN IF NOT EXISTS plan_tier                text,
  ADD COLUMN IF NOT EXISTS plan_verification_status text,
  ADD COLUMN IF NOT EXISTS plan_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS consent_record_id        uuid REFERENCES operator_session_consents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_default               boolean NOT NULL DEFAULT false;

-- Partial unique index: at most one default operator_session connection per subaccount.
CREATE UNIQUE INDEX IF NOT EXISTS ic_subaccount_operator_session_default_unique
  ON integration_connections (subaccount_id)
  WHERE auth_type = 'operator_session' AND is_default = true;

-- auth_type CHECK constraint (no existing constraint — safe to ADD directly).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'integration_connections_auth_type_check'
  ) THEN
    ALTER TABLE integration_connections
      ADD CONSTRAINT integration_connections_auth_type_check
      CHECK (auth_type IN ('oauth2', 'api_key', 'service_account', 'github_app', 'web_login', 'operator_session'));
  END IF;
END $$;
