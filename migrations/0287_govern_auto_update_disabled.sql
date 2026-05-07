-- 0287_govern_auto_update_disabled.sql
-- Consolidation C — Govern (spec.md §4.1, §6)
--
-- Adds:
--   1. memory_blocks.auto_update_disabled — Edit-and-override marker. Auto-extraction
--      pipeline reads this column and skips BOTH the memory_blocks UPDATE and the
--      memory_block_versions INSERT when true.
--   2. memory_block_versions.body_hash — canonicalised SHA-256 of override body.
--      Powers key-based idempotency via partial unique index. Nullable so legacy
--      rows are non-blocking; new override rows always populate it.
--
-- RLS: column-level additions only; no policy change.

ALTER TABLE memory_blocks
  ADD COLUMN auto_update_disabled boolean NOT NULL DEFAULT false;

ALTER TABLE memory_block_versions
  ADD COLUMN body_hash text;

CREATE UNIQUE INDEX memory_block_versions_block_body_hash_uq
  ON memory_block_versions (memory_block_id, body_hash)
  WHERE body_hash IS NOT NULL;
