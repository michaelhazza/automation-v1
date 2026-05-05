-- Migration 0197 — Universal Brief Phase 5 / W3a: memory_blocks precedence + deprecation
--
-- Adds columns needed for the Learned Rules library:
--   priority          — rule precedence within the same scope tier
--   is_authoritative  — authoritative rules outrank scope in retrieval
--   paused_at         — soft-pause (rule excluded from retrieval while paused)
--   deprecated_at     — soft-delete for audit trail
--   deprecation_reason — why deprecated
--   quality_score     — mirror of workspace_memory_entries.quality_score pattern
--   captured_via      — provenance discriminator for user-triggered rules
--
-- RLS: existing memory_blocks policies already cover the new columns
-- (column additions inherit the row-level policy; no new policy needed).

ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS is_authoritative boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS paused_at timestamp,
  ADD COLUMN IF NOT EXISTS deprecated_at timestamp,
  ADD COLUMN IF NOT EXISTS deprecation_reason text CHECK (
    deprecation_reason IN ('low_quality', 'user_replaced', 'conflict_resolved', 'user_deleted')
  ),
  ADD COLUMN IF NOT EXISTS quality_score numeric(3, 2) NOT NULL DEFAULT 0.50
    CHECK (quality_score >= 0.00 AND quality_score <= 1.00),
  ADD COLUMN IF NOT EXISTS captured_via text CHECK (
    captured_via IN ('manual_edit', 'auto_synthesised', 'user_triggered', 'approval_suggestion')
  );

-- Backfill captured_via for existing rows
UPDATE memory_blocks SET captured_via = CASE
  WHEN source = 'auto_synthesised' THEN 'auto_synthesised'
  ELSE 'manual_edit'
END
WHERE captured_via IS NULL;

ALTER TABLE memory_blocks ALTER COLUMN captured_via SET NOT NULL;

-- Partial indexes for efficient library queries
CREATE INDEX IF NOT EXISTS memory_blocks_paused_idx
  ON memory_blocks (paused_at)
  WHERE paused_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_blocks_deprecated_idx
  ON memory_blocks (deprecated_at)
  WHERE deprecated_at IS NOT NULL;

-- Index for authoritative rules retrieval
CREATE INDEX IF NOT EXISTS memory_blocks_authoritative_idx
  ON memory_blocks (organisation_id, is_authoritative)
  WHERE is_authoritative = true AND deleted_at IS NULL;
