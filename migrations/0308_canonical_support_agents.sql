CREATE TABLE canonical_support_agents (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID         NOT NULL REFERENCES organisations(id),
  connector_config_id  UUID         NOT NULL REFERENCES connector_configs(id),
  subaccount_id        UUID         REFERENCES subaccounts(id),
  external_id          TEXT         NOT NULL,
  display_name         TEXT         NOT NULL,
  email                TEXT,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  agent_kind           TEXT         NOT NULL,
  external_metadata    JSONB,
  last_synced_at       TIMESTAMP WITH TIME ZONE,
  source_connection_id UUID         REFERENCES integration_connections(id),
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_support_agents_connector_external_unique UNIQUE (connector_config_id, external_id),
  CONSTRAINT canonical_support_agents_agent_kind_enum CHECK (agent_kind IN ('human', 'bot'))
);

CREATE INDEX canonical_support_agents_org_kind_active_idx
  ON canonical_support_agents (organisation_id, agent_kind, is_active);

ALTER TABLE canonical_support_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_support_agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canonical_support_agents_org_isolation ON canonical_support_agents;
CREATE POLICY canonical_support_agents_org_isolation ON canonical_support_agents
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
