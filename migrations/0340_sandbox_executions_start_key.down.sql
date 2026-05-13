-- Down migration 0340: Remove sandbox_start_key from sandbox_executions

DROP INDEX IF EXISTS sandbox_executions_start_key_idx;

ALTER TABLE sandbox_executions
  DROP COLUMN IF EXISTS sandbox_start_key;
