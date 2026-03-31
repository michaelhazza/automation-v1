-- Phase 1A: Memory quality scoring
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS quality_score REAL;
ALTER TABLE workspace_memories ADD COLUMN IF NOT EXISTS quality_threshold REAL NOT NULL DEFAULT 0.5;

-- Phase 1B: Workspace entities
CREATE TABLE IF NOT EXISTS workspace_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  attributes JSONB DEFAULT '{}',
  confidence REAL,
  mention_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ,
  UNIQUE(subaccount_id, name, entity_type)
);

CREATE INDEX IF NOT EXISTS workspace_entities_subaccount_idx ON workspace_entities(subaccount_id);
CREATE INDEX IF NOT EXISTS workspace_entities_org_idx ON workspace_entities(organisation_id);

-- Phase 2A: Vector memory search (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE workspace_memory_entries ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding
  ON workspace_memory_entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_memory_entries_recent
  ON workspace_memory_entries (subaccount_id, created_at DESC)
  WHERE embedding IS NOT NULL;

-- Phase 2B: Agent triggers
CREATE TABLE IF NOT EXISTS agent_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  subaccount_agent_id UUID NOT NULL REFERENCES subaccount_agents(id),
  event_type TEXT NOT NULL,
  event_filter JSONB DEFAULT '{}',
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_triggers_subaccount_idx ON agent_triggers(subaccount_id);
CREATE INDEX IF NOT EXISTS agent_triggers_event_type_idx ON agent_triggers(subaccount_id, event_type);
