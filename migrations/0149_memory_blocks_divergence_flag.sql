-- Migration 0149 — memory_blocks.divergence_detected_at
--
-- Nullable timestamp set by the protectedBlockDivergenceService daily job
-- when a protected block's DB content diverges from its canonical file.
-- The UI banner reads this column without a round-trip file read.
--
-- Spec: docs/memory-and-briefings-spec.md §S24

ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS divergence_detected_at timestamptz;
