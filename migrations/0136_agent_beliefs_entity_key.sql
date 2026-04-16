-- ---------------------------------------------------------------------------
-- 0136_agent_beliefs_entity_key.sql
--
-- Memory & Briefings spec Phase 1 — §4.3 (S3)
--
-- Adds `entity_key` (nullable text) to `agent_beliefs`.  This column enables
-- cross-agent conflict detection: when multiple agents hold contradicting
-- beliefs about the same named entity (e.g. a client contact, a campaign, a
-- product), `beliefConflictService` can query on (subaccount_id, entity_key)
-- to find conflicts.
--
-- Column is nullable.  Existing beliefs without an explicit entity key simply
-- skip the conflict-detection path — conflict detection fires only when
-- beliefs carry an explicit `entityKey`.
--
-- Optional best-effort backfill of existing rows is a manual ops step;
-- leaving them null is safe (conflict detection falls back to no-op for
-- null rows).
-- ---------------------------------------------------------------------------

ALTER TABLE agent_beliefs
  ADD COLUMN IF NOT EXISTS entity_key text;

-- Partial index supporting the cross-agent conflict query:
-- SELECT * FROM agent_beliefs
-- WHERE subaccount_id = $1 AND entity_key = $2
--   AND deleted_at IS NULL AND superseded_by IS NULL
CREATE INDEX IF NOT EXISTS agent_beliefs_entity_key_idx
  ON agent_beliefs (subaccount_id, entity_key)
  WHERE deleted_at IS NULL AND superseded_by IS NULL AND entity_key IS NOT NULL;
