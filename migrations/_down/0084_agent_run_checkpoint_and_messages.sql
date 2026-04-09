-- Down migration for 0084_agent_run_checkpoint_and_messages.sql
--
-- Drops the Sprint 3A P2.1 append-only message log, the checkpoint
-- column, and the per-org run retention override. Safe to run:
--
--   * `agent_run_messages` is dropped outright. Running agents will
--     fall back to the in-memory messages[] array only. The resume
--     path lands in Sprint 3B and is not wired in 3A.
--   * `agent_run_snapshots.checkpoint` is additive and nullable — no
--     existing reader depends on it.
--   * `organisations.run_retention_days` is additive and nullable —
--     the cleanup cron falls back to DEFAULT_RUN_RETENTION_DAYS.
--
-- Order reversed from the up migration.

ALTER TABLE organisations DROP COLUMN IF EXISTS run_retention_days;

ALTER TABLE agent_run_snapshots DROP COLUMN IF EXISTS checkpoint;

DROP POLICY IF EXISTS agent_run_messages_org_isolation ON agent_run_messages;
ALTER TABLE IF EXISTS agent_run_messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agent_run_messages DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS agent_run_messages_tool_call_idx;
DROP INDEX IF EXISTS agent_run_messages_org_idx;
DROP INDEX IF EXISTS agent_run_messages_run_seq_unique;

DROP TABLE IF EXISTS agent_run_messages;
