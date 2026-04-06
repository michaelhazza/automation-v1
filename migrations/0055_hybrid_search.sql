-- Migration 0055: Add tsvector generated column + GIN index for hybrid search (B2)
-- Uses GENERATED ALWAYS AS ... STORED so Postgres auto-populates on INSERT/UPDATE.
-- Existing rows are backfilled automatically by the ALTER.

ALTER TABLE workspace_memory_entries
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;

CREATE INDEX idx_workspace_memory_entries_tsv
  ON workspace_memory_entries USING GIN (tsv);

ALTER TABLE org_memory_entries
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;

CREATE INDEX idx_org_memory_entries_tsv
  ON org_memory_entries USING GIN (tsv);
