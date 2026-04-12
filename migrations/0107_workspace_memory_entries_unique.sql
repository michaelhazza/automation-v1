-- 0107: Add unique constraint on workspace_memory_entries for migration idempotency
--
-- The org subaccount migration (0106) copies org_memory_entries into
-- workspace_memory_entries. Without a unique constraint, re-running the
-- migration creates duplicates. This adds a deduplication key on
-- (subaccount_id, agent_run_id, agent_id, content, entry_type) so the
-- migration's onConflictDoNothing() can safely skip existing rows.
--
-- The constraint also prevents duplicate entries from normal runtime writes.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  workspace_memory_entries_dedup_idx
  ON workspace_memory_entries (subaccount_id, agent_run_id, agent_id, entry_type, md5(content));

-- Wrap in a unique constraint so Drizzle's onConflictDoNothing can target it.
-- Postgres requires the index to exist first for ADD CONSTRAINT ... USING INDEX.
ALTER TABLE workspace_memory_entries
  ADD CONSTRAINT workspace_memory_entries_dedup
  UNIQUE USING INDEX workspace_memory_entries_dedup_idx;
