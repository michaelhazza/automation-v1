-- Config Backups: point-in-time snapshots of configuration entities.
-- Used by the skill analyser to capture pre-apply state, enabling one-click
-- revert. Generic enough for future backup scopes (manual, config_agent).

CREATE TABLE config_backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  scope         TEXT NOT NULL,             -- 'skill_analyzer' | 'manual' | 'config_agent'
  label         TEXT NOT NULL,
  source_id     TEXT,                      -- optional FK to triggering entity (e.g. job ID)
  entities      JSONB NOT NULL,            -- array of { entityType, entityId, snapshot }
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'restored' | 'expired'
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at   TIMESTAMPTZ,
  restored_by   UUID REFERENCES users(id)
);

CREATE INDEX config_backups_org_idx ON config_backups(organisation_id);
CREATE INDEX config_backups_scope_idx ON config_backups(organisation_id, scope);
CREATE INDEX config_backups_source_idx ON config_backups(source_id) WHERE source_id IS NOT NULL;
