-- =============================================================================
-- 0105 — Agent Intelligence Upgrade
-- Phases 0-3: search, memory, context, briefing
-- =============================================================================

-- ── Phase 2A: Temporal validity on workspace_entities ────────────────────────
ALTER TABLE workspace_entities
  ADD COLUMN valid_from  timestamptz DEFAULT NOW(),
  ADD COLUMN valid_to    timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES workspace_entities(id);

CREATE INDEX workspace_entities_validity_idx
  ON workspace_entities (subaccount_id, valid_to)
  WHERE deleted_at IS NULL;

-- Replace the old unique constraint that doesn't account for superseded entities.
-- Only one "current" (valid_to IS NULL) entity per (subaccount_id, name, entity_type)
DROP INDEX IF EXISTS workspace_entities_unique;
CREATE UNIQUE INDEX workspace_entities_current_unique
  ON workspace_entities (subaccount_id, name, entity_type)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

-- ── Phase 2C: Hierarchical metadata on workspace_memory_entries ─────────────
ALTER TABLE workspace_memory_entries
  ADD COLUMN domain  text,
  ADD COLUMN topic   text;

CREATE INDEX workspace_memory_entries_domain_idx
  ON workspace_memory_entries (subaccount_id, domain)
  WHERE domain IS NOT NULL;

-- ── Phase 2D: Agent briefings ───────────────────────────────────────────────
CREATE TABLE agent_briefings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id),
  agent_id          uuid NOT NULL REFERENCES agents(id),

  content           text NOT NULL,
  token_count       integer NOT NULL DEFAULT 0,
  source_run_ids    uuid[] NOT NULL DEFAULT '{}',
  version           integer NOT NULL DEFAULT 1,

  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX agent_briefings_unique
  ON agent_briefings (organisation_id, subaccount_id, agent_id);

-- ── Phase 3B: Subaccount state summaries ────────────────────────────────────
CREATE TABLE subaccount_state_summaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL REFERENCES organisations(id),
  subaccount_id     uuid NOT NULL REFERENCES subaccounts(id),

  content           text NOT NULL,
  token_count       integer NOT NULL DEFAULT 0,
  task_counts       jsonb NOT NULL DEFAULT '{}',
  agent_run_stats   jsonb NOT NULL DEFAULT '{}',
  health_summary    text,

  generated_at      timestamptz NOT NULL DEFAULT NOW(),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX subaccount_state_summaries_unique
  ON subaccount_state_summaries (organisation_id, subaccount_id);

-- ── RLS policies for new tables ─────────────────────────────────────────────
ALTER TABLE agent_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_briefings FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_briefings_tenant_isolation ON agent_briefings
  USING (organisation_id::text = current_setting('app.organisation_id', true));

ALTER TABLE subaccount_state_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_state_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY subaccount_state_summaries_tenant_isolation ON subaccount_state_summaries
  USING (organisation_id::text = current_setting('app.organisation_id', true));
