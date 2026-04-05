-- MCP Server Configs — org-level definitions of external MCP tool servers

CREATE TABLE mcp_server_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  preset_slug TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  transport TEXT NOT NULL,
  command TEXT,
  args JSONB,
  endpoint_url TEXT,
  env_encrypted TEXT,
  credential_provider TEXT,
  fixed_connection_id UUID REFERENCES integration_connections(id),
  allowed_tools JSONB,
  blocked_tools JSONB,
  default_gate_level TEXT NOT NULL DEFAULT 'auto',
  tool_gate_overrides JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  connection_mode TEXT NOT NULL DEFAULT 'eager',
  status TEXT NOT NULL DEFAULT 'active',
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  discovered_tools_json JSONB,
  discovered_tools_hash TEXT,
  last_tools_refresh_at TIMESTAMPTZ,
  rejected_tool_count INTEGER DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mcp_server_configs_org_slug_unique ON mcp_server_configs(organisation_id, slug);
CREATE INDEX mcp_server_configs_org_idx ON mcp_server_configs(organisation_id);
CREATE INDEX mcp_server_configs_status_idx ON mcp_server_configs(status);

CREATE TABLE mcp_server_agent_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_server_config_id UUID NOT NULL REFERENCES mcp_server_configs(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  gate_override TEXT,
  allowed_tools_override JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX mcp_server_agent_links_unique ON mcp_server_agent_links(mcp_server_config_id, agent_id);
