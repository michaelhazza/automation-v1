-- 0065_final_hardening.sql
-- Pre-merge hardening: self-reference guard, partial unique index, backward-safe enums

-- Goal self-reference prevention at DB level
ALTER TABLE goals ADD CONSTRAINT goals_no_self_parent
  CHECK (id <> parent_goal_id);

-- Attachment idempotency: partial unique index (NULL bypass fix)
ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attach_idempotency;
CREATE UNIQUE INDEX task_attach_idempotency_partial
  ON task_attachments(task_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Inbox read states cleanup index (for TTL job)
CREATE INDEX inbox_read_states_cleanup_idx
  ON inbox_read_states(is_archived, created_at)
  WHERE is_archived = true;

-- Inbox performance indexes
CREATE INDEX IF NOT EXISTS inbox_read_entity_idx
  ON inbox_read_states(entity_type, entity_id);

-- Subaccount org inbox filter index
CREATE INDEX IF NOT EXISTS subaccounts_org_inbox_idx
  ON subaccounts(organisation_id, include_in_org_inbox)
  WHERE deleted_at IS NULL;
