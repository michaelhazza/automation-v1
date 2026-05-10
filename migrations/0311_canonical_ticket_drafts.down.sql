-- 0311_canonical_ticket_drafts.down.sql
-- Reverses migration 0311_canonical_ticket_drafts.sql.
--
-- Order is CRITICAL: must drop the FK + index on canonical_ticket_messages BEFORE
-- dropping canonical_ticket_drafts, otherwise Postgres refuses the table drop
-- due to the active FK reference.

-- Step 1: drop the partial index on canonical_ticket_messages (deferred from 0310)
DROP INDEX IF EXISTS canonical_ticket_messages_source_draft_idx;

-- Step 2: drop the FK constraint on canonical_ticket_messages (deferred from 0310)
ALTER TABLE canonical_ticket_messages
  DROP CONSTRAINT IF EXISTS canonical_ticket_messages_source_draft_id_fkey;

-- Step 3: drop the RLS policy on canonical_ticket_drafts
DROP POLICY IF EXISTS canonical_ticket_drafts_org_isolation ON canonical_ticket_drafts;

-- Step 4: drop the drafts table (all indexes are dropped automatically with the table)
DROP TABLE IF EXISTS canonical_ticket_drafts;
