-- =============================================================================
-- IEE — eventEmittedAt observability column (reviewer round 3 #1)
-- Spec: docs/iee-development-spec.md, Appendix A.1 reconnect hook.
--
-- Tracks whether the iee-run-completed pg-boss event was successfully
-- emitted by finalizeRun(). NULL means not yet emitted (or last emit
-- failed); a non-null value is the publish timestamp. The cleanup job
-- retries nulls on terminal rows so the agent-resume hook is never
-- silently lost.
-- =============================================================================

ALTER TABLE iee_runs
  ADD COLUMN IF NOT EXISTS event_emitted_at TIMESTAMPTZ;

-- Partial index — only rows that need a retry pay the index cost.
CREATE INDEX IF NOT EXISTS iee_runs_event_pending_idx
  ON iee_runs (status, completed_at)
  WHERE event_emitted_at IS NULL
    AND status IN ('completed', 'failed')
    AND deleted_at IS NULL;
