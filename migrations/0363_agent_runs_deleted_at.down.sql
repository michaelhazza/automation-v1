BEGIN;
DROP INDEX IF EXISTS agent_runs_deleted_at_idx;
ALTER TABLE agent_runs DROP COLUMN IF EXISTS deleted_at;
COMMIT;
