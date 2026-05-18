ALTER TABLE memory_review_queue
  ADD COLUMN IF NOT EXISTS block_id uuid NULL,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS memory_review_queue_pending_procedural_promotion_idx
  ON memory_review_queue (block_id, item_type)
  WHERE block_id IS NOT NULL
    AND item_type = 'promote_to_procedural'
    AND status = 'pending';
