ALTER TABLE workspace_memory_entries
  ADD COLUMN consolidation_tier text NOT NULL DEFAULT 'episodic'
  CHECK (consolidation_tier IN ('working','episodic','semantic','procedural'));

CREATE INDEX workspace_memory_entries_consolidation_tier_idx
  ON workspace_memory_entries (organisation_id, subaccount_id, consolidation_tier)
  WHERE deleted_at IS NULL;
