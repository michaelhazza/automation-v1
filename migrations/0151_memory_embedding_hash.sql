-- migrations/0151_memory_embedding_hash.sql
-- External code review §2.1 — content-hash-based embedding invalidation.
--
-- Problem: workspace_memory_entries.content can be mutated by the dedup UPDATE
-- path (workspaceMemoryService.ts) but the corresponding embedding is never
-- recomputed, so vector search silently returns matches against stale text.
--
-- Solution: track the content hash that the embedding was computed from, and
-- expose a derived content_hash so callers can detect drift cheaply
-- (md5(content) != embedding_content_hash → stale).

-- ============================================================
-- 1. Generated content_hash (derived from content; auto-maintained)
-- 2. embedding_content_hash (the hash the embedding was computed from)
-- ============================================================
ALTER TABLE workspace_memory_entries
  ADD COLUMN content_hash           TEXT GENERATED ALWAYS AS (md5(content)) STORED,
  ADD COLUMN embedding_content_hash TEXT;

-- Backfill: any entry that already has an embedding is assumed fresh at
-- migration time. Going forward, every embedding write must set this column
-- (workspaceMemoryService.ts is updated in the same change).
UPDATE workspace_memory_entries
   SET embedding_content_hash = md5(content)
 WHERE embedding IS NOT NULL;

-- Partial index: a backfill job (future work) can scan this index in O(stale)
-- instead of O(rows) to find entries needing re-embedding.
CREATE INDEX workspace_memory_entries_stale_embedding_idx
  ON workspace_memory_entries (subaccount_id)
  WHERE embedding IS NOT NULL
    AND embedding_content_hash IS DISTINCT FROM content_hash;
