BEGIN;
ALTER TABLE sandbox_executions
  ADD COLUMN IF NOT EXISTS credential_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
