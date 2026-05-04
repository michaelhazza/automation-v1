-- Runs in a single transaction. DO NOT split or run outside a transaction — there is a gap between DROP and CREATE where uniqueness protection is absent.
BEGIN;
DROP INDEX IF EXISTS conversations_unique_scope;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_scope ON conversations (organisation_id, scope_type, scope_id);
COMMIT;
