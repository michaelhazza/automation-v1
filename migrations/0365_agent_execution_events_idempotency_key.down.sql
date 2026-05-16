-- Down for 0365_agent_execution_events_idempotency_key.sql.
DROP INDEX IF EXISTS agent_execution_events_idempotency_idx;
ALTER TABLE agent_execution_events DROP COLUMN IF EXISTS idempotency_key;
