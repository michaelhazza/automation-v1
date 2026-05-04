-- Down migration for 0274_actions_agent_id_nullable.sql
-- Restores actions.agent_id NOT NULL constraint.
--
-- Safety note: this DOWN migration will FAIL if any rows in `actions` have
-- agent_id IS NULL (e.g. system-initiated rows like promote_spending_policy_to_live).
-- Operators rolling this back must first delete or backfill any such rows.
-- The rollback is intentionally strict — the original schema invariant assumed
-- every action had an agent author; reapplying that invariant cannot silently
-- drop rows.

ALTER TABLE actions ALTER COLUMN agent_id SET NOT NULL;
