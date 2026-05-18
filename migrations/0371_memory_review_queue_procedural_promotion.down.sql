DROP INDEX IF EXISTS memory_review_queue_pending_procedural_promotion_idx;

-- Drop the up-migration's check constraint first so the cleanup DELETE below
-- isn't blocked by stale referential integrity, then remove every row whose
-- item_type was introduced by this migration. Without the DELETE, the
-- subsequent ADD CONSTRAINT below would fail in any environment where a
-- promote_to_procedural row has been queued.
ALTER TABLE memory_review_queue
  DROP CONSTRAINT IF EXISTS memory_review_queue_item_type_check;

DELETE FROM memory_review_queue
  WHERE item_type = 'promote_to_procedural';

-- Restore the original (pre-0371) check constraint shape from migration 0139.
ALTER TABLE memory_review_queue
  ADD CONSTRAINT memory_review_queue_item_type_check
    CHECK (item_type IN ('belief_conflict', 'block_proposal', 'clarification_pending'));

ALTER TABLE memory_review_queue
  DROP COLUMN IF EXISTS cooldown_until,
  DROP COLUMN IF EXISTS block_id;
