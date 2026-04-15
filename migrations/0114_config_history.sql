-- Config History — generic JSONB changelog for all configuration entities
-- Supports record-level version history and point-in-time restore

CREATE TABLE config_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id),
  entity_type      TEXT NOT NULL,
  entity_id        UUID NOT NULL,
  version          INTEGER NOT NULL,
  snapshot         JSONB NOT NULL,
  changed_by       UUID REFERENCES users(id),
  change_source    TEXT NOT NULL DEFAULT 'ui',
  session_id       UUID,
  change_summary   TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT config_history_entity_version_uniq
    UNIQUE(entity_type, entity_id, version)
);

CREATE INDEX config_history_org_idx ON config_history(organisation_id);
CREATE INDEX config_history_entity_idx ON config_history(entity_type, entity_id);
CREATE INDEX config_history_session_idx ON config_history(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX config_history_changed_at_idx ON config_history(organisation_id, changed_at DESC);

-- Add configPlanJson to agent_runs for plan replayability
ALTER TABLE agent_runs ADD COLUMN config_plan_json JSONB;
