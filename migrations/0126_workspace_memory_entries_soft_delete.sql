-- ---------------------------------------------------------------------------
-- 0126 — soft delete for workspace_memory_entries (Reference notes).
--
-- Spec §7 G6.2 / docs/onboarding-playbooks-spec.md:
--   "Reference notes are created, edited, renamed, archived, and
--   soft-deleted through the page."
--
-- Adds:
--   - deleted_at (tombstone)
--   - partial index to make list-filtered lookups fast
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS workspace_memory_entries_active_idx
  ON workspace_memory_entries (subaccount_id)
  WHERE deleted_at IS NULL;
