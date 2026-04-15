-- ---------------------------------------------------------------------------
-- 0127 — Reference notes carry a back-link to the Insight they were
-- promoted from (spec §7 G6.4).
--
-- The Knowledge page's new "Insights" tab offers a Promote-to-Reference
-- affordance that creates a new workspace_memory_entries row with
-- promoted_from_entry_id pointing at the originating auto-captured entry.
-- Nullable FK + ON DELETE SET NULL so dropping the source does not cascade.
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_memory_entries
  ADD COLUMN IF NOT EXISTS promoted_from_entry_id UUID
    REFERENCES workspace_memory_entries (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workspace_memory_entries_promoted_from_idx
  ON workspace_memory_entries (promoted_from_entry_id)
  WHERE promoted_from_entry_id IS NOT NULL;
