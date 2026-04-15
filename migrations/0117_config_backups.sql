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
CREATE UNIQUE INDEX config_backups_source_uniq ON config_backups(organisation_id, source_id) WHERE source_id IS NOT NULL;

-- =============================================================================
-- Part 2: Subaccount skills — schema changes on `skills` table
-- =============================================================================

-- Add subaccount_id column to skills
ALTER TABLE skills ADD COLUMN subaccount_id uuid REFERENCES subaccounts(id);

-- Add tier integrity constraint
ALTER TABLE skills ADD CONSTRAINT skills_tier_check CHECK (
  (organisation_id IS NULL AND subaccount_id IS NULL) OR
  (organisation_id IS NOT NULL AND subaccount_id IS NULL) OR
  (organisation_id IS NOT NULL AND subaccount_id IS NOT NULL)
);

-- Replace slug uniqueness: drop old, create new partial indexes
DROP INDEX IF EXISTS skills_slug_org_idx;

CREATE UNIQUE INDEX skills_slug_system_uniq
  ON skills (slug)
  WHERE organisation_id IS NULL AND subaccount_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX skills_slug_org_uniq
  ON skills (organisation_id, slug)
  WHERE subaccount_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX skills_slug_subaccount_uniq
  ON skills (subaccount_id, slug)
  WHERE subaccount_id IS NOT NULL AND deleted_at IS NULL;

-- Index for subaccount skill queries
CREATE INDEX skills_subaccount_idx ON skills (subaccount_id);

-- =============================================================================
-- Part 3: Skill versions — integrity columns and constraints
-- =============================================================================

-- Add structured change type for filtering and audit clarity
ALTER TABLE skill_versions ADD COLUMN change_type TEXT;
-- Backfill existing rows (all from Skill Studio) as 'update'
UPDATE skill_versions SET change_type = 'update' WHERE change_type IS NULL;
-- Make NOT NULL after backfill
ALTER TABLE skill_versions ALTER COLUMN change_type SET NOT NULL;

-- Add idempotency key for retry-safe version writes
ALTER TABLE skill_versions ADD COLUMN idempotency_key TEXT;

-- Unique constraint: prevent duplicate version numbers per skill (safety net for FOR UPDATE lock)
CREATE UNIQUE INDEX skill_versions_version_uniq
  ON skill_versions (COALESCE(system_skill_id, skill_id), version_number);

-- Unique constraint: prevent duplicate idempotency keys per skill (retry dedup)
CREATE UNIQUE INDEX skill_versions_idempotency_uniq
  ON skill_versions (COALESCE(system_skill_id, skill_id), idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Performance index for Skill Studio history queries (version timeline)
CREATE INDEX skill_versions_skill_created_idx
  ON skill_versions (COALESCE(system_skill_id, skill_id), created_at DESC);

-- =============================================================================
-- Part 4: Subaccount skill permissions
-- =============================================================================

-- Seed new permission keys (follows existing seed pattern)
INSERT INTO permissions (key, description, group_name)
VALUES
  ('subaccount.skills.view', 'View subaccount-scoped skills', 'subaccount.skills'),
  ('subaccount.skills.manage', 'Create, edit, and delete subaccount-scoped skills', 'subaccount.skills')
ON CONFLICT (key) DO NOTHING;
