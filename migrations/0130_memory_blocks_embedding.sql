-- ---------------------------------------------------------------------------
-- 0130_memory_blocks_embedding.sql
--
-- Memory & Briefings spec Phase 1 — §5.2 (S6)
--
-- Adds an `embedding vector(1536)` column to `memory_blocks` for
-- relevance-driven block retrieval. The column is nullable so existing rows
-- are valid immediately; a one-shot pg-boss backfill job
-- (`memory-blocks-embedding-backfill`) scheduled on Phase 2 deploy fills
-- the embeddings for legacy rows.
--
-- HNSW index is created here at initial deploy because the column is empty
-- (no meaningful data volume). Per build-plan note: if a large existing
-- volume existed the index would be deferred to a separate migration after
-- the backfill completes to avoid locking the table during index build.
--
-- Requires the pgvector extension to be installed.  This is already present
-- in the database (migration 0029 and skill_embeddings depend on it).
-- ---------------------------------------------------------------------------

ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for cosine-distance nearest-neighbour search.
-- Scoped to active, non-deleted blocks — the relevance retrieval query only
-- ever scans this subset, so the partial index keeps it compact.
CREATE INDEX IF NOT EXISTS memory_blocks_embedding_hnsw
  ON memory_blocks
  USING hnsw (embedding vector_cosine_ops)
  WHERE deleted_at IS NULL AND status = 'active';
