-- Migration 0268: GHL agency-level OAuth — connector_configs + subaccounts extensions
-- Spec: docs/ghl-module-c-oauth-spec.md §7 Migrations, §5.4, §6 Phase 2
-- Branch: ghl-agency-oauth

-- ── connector_configs: agency token columns ───────────────────────────────────

ALTER TABLE connector_configs ADD COLUMN token_scope TEXT NOT NULL DEFAULT 'agency';
ALTER TABLE connector_configs ADD COLUMN company_id TEXT;
ALTER TABLE connector_configs ADD COLUMN installed_at TIMESTAMPTZ;
ALTER TABLE connector_configs ADD COLUMN disconnected_at TIMESTAMPTZ;

-- Agency token columns (dedicated, not in configJson — required for expiry queries).
ALTER TABLE connector_configs ADD COLUMN access_token TEXT;
ALTER TABLE connector_configs ADD COLUMN refresh_token TEXT;
ALTER TABLE connector_configs ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE connector_configs ADD COLUMN scope TEXT NOT NULL DEFAULT '';

-- Per-org unique index: one active agency connection per (org, connector_type, agency).
-- Partial: only applies to agency-scope rows that are not yet disconnected.
CREATE UNIQUE INDEX connector_configs_org_agency_uniq
  ON connector_configs(organisation_id, connector_type, company_id)
  WHERE token_scope = 'agency' AND status <> 'disconnected';

-- Global unique index: one GHL agency can belong to only one Automation OS org at a time.
-- Enables O(1) webhook → org routing by (connector_type, company_id).
-- If status becomes 'disconnected', the index slot is freed for re-install under
-- a different org (e.g. after an UNINSTALL + reinstall flow).
CREATE UNIQUE INDEX connector_configs_global_agency_uniq
  ON connector_configs(connector_type, company_id)
  WHERE token_scope = 'agency' AND status <> 'disconnected';

-- ── subaccounts: GHL location linkage columns ────────────────────────────────
-- connector_config_id: which agency install created this sub-account row (nullable for non-GHL)
-- external_id: GHL locationId (nullable for manually-created subaccounts)

ALTER TABLE subaccounts ADD COLUMN connector_config_id UUID REFERENCES connector_configs(id);
ALTER TABLE subaccounts ADD COLUMN external_id TEXT;

-- Partial unique index: one active (connector_config, GHL location) pair.
-- WHERE clause excludes rows that lack either column (manually-created subaccounts).
CREATE UNIQUE INDEX subaccounts_connector_external_uniq
  ON subaccounts(connector_config_id, external_id)
  WHERE deleted_at IS NULL
    AND connector_config_id IS NOT NULL
    AND external_id IS NOT NULL;
