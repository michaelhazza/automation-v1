-- Migration 0054: Add embedding_context column for contextual retrieval (B1)
-- Stores LLM-generated context prefix used to enrich embeddings.
-- Nullable: existing entries will have NULL until backfilled via async job.

ALTER TABLE workspace_memory_entries
  ADD COLUMN embedding_context TEXT;

ALTER TABLE org_memory_entries
  ADD COLUMN embedding_context TEXT;
