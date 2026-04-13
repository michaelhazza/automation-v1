-- 0107: Add unique constraint on workspace_memory_entries for migration idempotency
--
-- The org subaccount migration (0106) copies org_memory_entries into
-- workspace_memory_entries. Without a unique constraint, re-running the
-- migration creates duplicates. This adds a deduplication key on
-- (subaccount_id, agent_run_id, agent_id, content, entry_type) so the
-- migration's onConflictDoNothing() can safely skip existing rows.
--
-- The constraint also prevents duplicate entries from normal runtime writes.

CREATE UNIQUE INDEX IF NOT EXISTS
  workspace_memory_entries_dedup_idx
  ON workspace_memory_entries (subaccount_id, agent_run_id, agent_id, entry_type, md5(content));
-- Note: UNIQUE USING INDEX cannot target expression-based indexes in Postgres.
-- The index alone enforces uniqueness; onConflictDoNothing() needs no named constraint.
