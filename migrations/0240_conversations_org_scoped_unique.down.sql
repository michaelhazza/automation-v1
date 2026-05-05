BEGIN;
DROP INDEX IF EXISTS conversations_unique_scope;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_scope ON conversations (scope_type, scope_id);
COMMIT;
