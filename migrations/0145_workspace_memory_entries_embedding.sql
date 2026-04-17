-- migrations/0145_workspace_memory_entries_embedding.sql
--
-- Migration 0029 added the embedding column and HNSW index inside a
-- DO $$ BEGIN ... EXCEPTION ... END $$ block that gracefully skipped the
-- pgvector setup when the extension was not installed. On databases where
-- pgvector was absent at the time 0029 ran, the column was never created.
--
-- This migration adds the column and index unconditionally now that
-- pgvector is installed. IF NOT EXISTS guards make it idempotent for
-- databases that already have the column from migration 0029.

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_memory_entries_embedding
  ON workspace_memory_entries USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
