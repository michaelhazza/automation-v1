-- migrations/0302_memory_blocks_operator_correction.sql
-- Trust & Verification Layer spec §6.7, §10.1 — Stage 3 correction capture.
-- Extends memory_blocks.captured_via enum to include 'operator_correction'.
-- Adds partial unique index for per-run correction idempotency (last-write-wins).

-- Extend the captured_via check constraint to include 'operator_correction'.
-- The existing constraint name must match what was set in prior migrations.
-- We drop and recreate to extend the allowed set.

DO $$
BEGIN
  -- Only drop if it exists to be idempotent
  ALTER TABLE memory_blocks
    DROP CONSTRAINT IF EXISTS memory_blocks_captured_via_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

ALTER TABLE memory_blocks
  ADD CONSTRAINT memory_blocks_captured_via_check
    CHECK (captured_via IN (
      'manual_edit',
      'auto_synthesised',
      'user_triggered',
      'approval_suggestion',
      'operator_correction'
    ));

-- Partial unique index: one active correction per (org, source_run).
-- Re-clicking Correct on the same run UPSERTs into the same row (last-write-wins).
-- source_run_id is already nullable; the WHERE clause filters to correction rows only.

CREATE UNIQUE INDEX IF NOT EXISTS memory_blocks_correction_run_uniq
  ON memory_blocks (organisation_id, source_run_id)
  WHERE captured_via = 'operator_correction'
    AND deleted_at IS NULL;
