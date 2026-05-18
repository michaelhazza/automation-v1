ALTER TABLE memory_review_queue
  ADD COLUMN IF NOT EXISTS block_id uuid NULL,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz NULL;

-- Extend the item_type check constraint to allow 'promote_to_procedural'.
-- The original constraint was added in migration 0139 and only allowed the
-- three legacy item types; without this drop/recreate, every procedural
-- promotion insert in memoryConsolidationPromotionDispatcher fails with a
-- check-constraint violation.
ALTER TABLE memory_review_queue
  DROP CONSTRAINT IF EXISTS memory_review_queue_item_type_check;

ALTER TABLE memory_review_queue
  ADD CONSTRAINT memory_review_queue_item_type_check
    CHECK (item_type IN ('belief_conflict', 'block_proposal', 'clarification_pending', 'promote_to_procedural'));

CREATE UNIQUE INDEX IF NOT EXISTS memory_review_queue_pending_procedural_promotion_idx
  ON memory_review_queue (block_id, item_type)
  WHERE block_id IS NOT NULL
    AND item_type = 'promote_to_procedural'
    AND status = 'pending';
