-- ---------------------------------------------------------------------------
-- 0129_memory_blocks_status_source.sql
--
-- Memory & Briefings spec Phase 1 — §5.2, §5.11
--
-- Adds `status` and `source` columns to `memory_blocks` so the block
-- injection pipeline can enforce the global "only inject active blocks"
-- invariant and so the auto-synthesis pipeline can track block provenance.
--
-- Defaults cover all existing rows:
--   status  = 'active'  (existing blocks are live, no change in behaviour)
--   source  = 'manual'  (all pre-migration blocks were human-authored)
--
-- Adds a partial index on (organisation_id, subaccount_id) WHERE
-- status='active' AND deleted_at IS NULL to make the injection query fast.
-- ---------------------------------------------------------------------------

ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- Constrain to documented enum values
ALTER TABLE memory_blocks
  ADD CONSTRAINT memory_blocks_status_check
    CHECK (status IN ('active', 'draft', 'pending_review', 'rejected')),
  ADD CONSTRAINT memory_blocks_source_check
    CHECK (source IN ('manual', 'auto_synthesised'));

-- Partial index for fast active-block lookup during context injection
CREATE INDEX IF NOT EXISTS memory_blocks_active_idx
  ON memory_blocks (organisation_id, subaccount_id)
  WHERE status = 'active' AND deleted_at IS NULL;
