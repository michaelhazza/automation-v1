-- ---------------------------------------------------------------------------
-- 0128_memory_block_source_reference.sql
--
-- Phase D1 of docs/onboarding-playbooks-spec.md (§7.3).
--
-- Adds `source_reference_id` to `memory_blocks` so a block that was promoted
-- from a Reference (workspace_memory_entries row) retains provenance. The FK
-- uses ON DELETE SET NULL so deleting the source Reference does NOT cascade
-- into the block — promotion is non-destructive and the block continues to
-- exist on its own once promoted.
--
-- Renumbered from 0118 → 0128 on 2026-04-15 to resolve a prefix collision
-- with main's `0118_skill_analyzer_merge_quality.sql`. The feature branch
-- originally claimed 0118 before the skill-analyzer work landed on main.
-- Both files are independent, but keeping one number per migration avoids
-- future confusion.
--
-- If your local dev DB already applied this file as 0118, manually clean up
-- the stale tracking row before running migrations:
--   DELETE FROM schema_migrations WHERE filename = '0118_memory_block_source_reference.sql';
-- ---------------------------------------------------------------------------

ALTER TABLE memory_blocks
  ADD COLUMN IF NOT EXISTS source_reference_id uuid
    REFERENCES workspace_memory_entries(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS memory_blocks_source_reference_idx
  ON memory_blocks (source_reference_id)
  WHERE source_reference_id IS NOT NULL;

-- Unified Knowledge page (spec §7.2) supports manually-authored References
-- (Tiptap editor) and Block→Reference demotion (§7.3). Both paths produce
-- rows with no source agent run. Drop the NOT NULL constraint on
-- `agent_run_id` and `agent_id` so these manual paths can write without
-- fabricating a synthetic agent run. Existing rows keep their values —
-- the change is additive.
ALTER TABLE workspace_memory_entries
  ALTER COLUMN agent_run_id DROP NOT NULL,
  ALTER COLUMN agent_id     DROP NOT NULL;
