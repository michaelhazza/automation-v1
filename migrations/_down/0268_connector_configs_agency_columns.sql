DROP INDEX IF EXISTS subaccounts_connector_external_uniq;
ALTER TABLE subaccounts DROP COLUMN IF EXISTS external_id;
ALTER TABLE subaccounts DROP COLUMN IF EXISTS connector_config_id;

DROP INDEX IF EXISTS connector_configs_global_agency_uniq;
DROP INDEX IF EXISTS connector_configs_org_agency_uniq;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS scope;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS expires_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS refresh_token;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS access_token;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS disconnected_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS installed_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS company_id;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS token_scope;
