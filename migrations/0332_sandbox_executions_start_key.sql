-- Migration 0332: Add sandbox_start_key to sandbox_executions
--
-- Adds the adoption seam for the Operator Backend's dispatch-crash recovery
-- (Chunk 4 of the operator-backend build). The Operator Backend passes
-- sandboxStartKey = operator_run_id so that a retried dispatch re-adopts
-- the already-started sandbox rather than creating a duplicate.
--
-- UNIQUE partial index enforces one-sandbox-per-start-key. NULL values are
-- excluded so the many existing rows (which have no start key) are unaffected.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §7.1, §5.3

ALTER TABLE sandbox_executions
  ADD COLUMN IF NOT EXISTS sandbox_start_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sandbox_executions_start_key_idx
  ON sandbox_executions (sandbox_start_key)
  WHERE sandbox_start_key IS NOT NULL;
