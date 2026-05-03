-- Migration 0269: connector_location_tokens table
-- Spec: docs/ghl-module-c-oauth-spec.md §7 Migrations, §5.2, §6 Phase 4
-- Branch: ghl-agency-oauth

CREATE TABLE connector_location_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_config_id UUID NOT NULL REFERENCES connector_configs(id),
  location_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Unique partial index: authoritative concurrency guard for mint races.
-- Only one live (non-deleted) token row per (connector_config, location).
CREATE UNIQUE INDEX connector_location_tokens_live_uniq
  ON connector_location_tokens(connector_config_id, location_id)
  WHERE deleted_at IS NULL;

-- Secondary index: fast expiry-check sweep for the refresh/prune path.
CREATE INDEX connector_location_tokens_expires_idx
  ON connector_location_tokens(expires_at)
  WHERE deleted_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tenant isolation via connector_config_id → connector_configs.organisation_id.
-- A row is visible only when the session org matches the parent connector_config's org.

ALTER TABLE connector_location_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_location_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_location_tokens_org_isolation ON connector_location_tokens;
CREATE POLICY connector_location_tokens_org_isolation ON connector_location_tokens
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM connector_configs cc
      WHERE cc.id = connector_config_id
        AND cc.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM connector_configs cc
      WHERE cc.id = connector_config_id
        AND cc.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
