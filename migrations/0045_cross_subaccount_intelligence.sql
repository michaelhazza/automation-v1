-- Migration 0045: Cross-subaccount intelligence infrastructure
-- Part of Phase 3: Cross-Subaccount Intelligence + Portfolio Health Agent

-- =============================================================================
-- 1. Subaccount Tags — user-defined key-value tags for cohort analysis
-- =============================================================================

CREATE TABLE subaccount_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (subaccount_id, key)
);

CREATE INDEX subaccount_tags_org_key_value_idx ON subaccount_tags (organisation_id, key, value);
CREATE INDEX subaccount_tags_subaccount_idx ON subaccount_tags (subaccount_id);

-- =============================================================================
-- 2. Org Memories — compiled summary per organisation (one per org)
-- =============================================================================

CREATE TABLE org_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) UNIQUE,
  summary text,
  quality_threshold real NOT NULL DEFAULT 0.5,
  runs_since_summary integer NOT NULL DEFAULT 0,
  summary_threshold integer NOT NULL DEFAULT 5,
  version integer NOT NULL DEFAULT 1,
  summary_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. Org Memory Entries — individual cross-subaccount insights
-- =============================================================================

CREATE TABLE org_memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  source_subaccount_ids jsonb,
  agent_run_id uuid REFERENCES agent_runs(id),
  agent_id uuid REFERENCES agents(id),
  content text NOT NULL,
  entry_type text NOT NULL DEFAULT 'observation',
  scope_tags jsonb,
  quality_score real NOT NULL DEFAULT 0.5,
  evidence_count integer NOT NULL DEFAULT 1,
  included_in_summary boolean NOT NULL DEFAULT false,
  access_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Vector column for semantic search (optional — pgvector required)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE org_memory_entries ADD COLUMN IF NOT EXISTS embedding vector(1536);
  CREATE INDEX IF NOT EXISTS org_memory_entries_embedding_idx
    ON org_memory_entries USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available, skipping vector column on org_memory_entries: %', SQLERRM;
END $$;

CREATE INDEX org_memory_entries_org_idx ON org_memory_entries (organisation_id, included_in_summary);
CREATE INDEX org_memory_entries_type_idx ON org_memory_entries (organisation_id, entry_type);
