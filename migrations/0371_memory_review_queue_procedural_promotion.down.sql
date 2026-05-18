DROP INDEX IF EXISTS memory_review_queue_pending_procedural_promotion_idx;
ALTER TABLE memory_review_queue
  DROP COLUMN IF EXISTS cooldown_until,
  DROP COLUMN IF EXISTS block_id;
