-- migrations/0295_memory_blocks_operator_correction.down.sql
-- Reverses migration 0295: remove 'operator_correction' from captured_via enum.

DROP INDEX IF EXISTS memory_blocks_correction_run_uniq;

ALTER TABLE memory_blocks
  DROP CONSTRAINT IF EXISTS memory_blocks_captured_via_check;

ALTER TABLE memory_blocks
  ADD CONSTRAINT memory_blocks_captured_via_check
    CHECK (captured_via IN (
      'manual_edit',
      'auto_synthesised',
      'user_triggered',
      'approval_suggestion'
    ));
