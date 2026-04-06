-- 0070_subaccount_integrations.sql
-- Add subaccount scoping to MCP server configs and connector configs

ALTER TABLE mcp_server_configs
  ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id);

CREATE INDEX mcp_server_configs_subaccount_idx
  ON mcp_server_configs(subaccount_id)
  WHERE subaccount_id IS NOT NULL;

DROP INDEX IF EXISTS mcp_server_configs_org_slug_idx;
CREATE UNIQUE INDEX mcp_server_configs_org_slug_idx
  ON mcp_server_configs(organisation_id, slug)
  WHERE subaccount_id IS NULL;
CREATE UNIQUE INDEX mcp_server_configs_sub_slug_idx
  ON mcp_server_configs(organisation_id, subaccount_id, slug)
  WHERE subaccount_id IS NOT NULL;

ALTER TABLE connector_configs
  ADD COLUMN subaccount_id UUID REFERENCES subaccounts(id);

CREATE INDEX connector_configs_subaccount_idx
  ON connector_configs(subaccount_id)
  WHERE subaccount_id IS NOT NULL;

DROP INDEX IF EXISTS connector_configs_org_type_idx;
CREATE UNIQUE INDEX connector_configs_org_type_idx
  ON connector_configs(organisation_id, connector_type)
  WHERE subaccount_id IS NULL;
CREATE UNIQUE INDEX connector_configs_sub_type_idx
  ON connector_configs(organisation_id, subaccount_id, connector_type)
  WHERE subaccount_id IS NOT NULL;
