-- Migration 0158 — Orchestrator routing hardening
-- Addresses pr-reviewer findings on commits d58fdc4 + 9065124 + 56affc1:
--   1. Feature request dedupe: advisory lock was serialising concurrent
--      orchestrator runs but DB-level uniqueness was not enforced. A
--      sufficiently pathological race (different workers, different app
--      instances, advisory lock contention tie) could still land two rows
--      with the same (org, category, dedupe_hash) within the 30-day window.
--   2. Routing outcomes: decision_record_id had no FK integrity and no
--      format validation. Document it as external (UUIDs emitted by the
--      Orchestrator into its agent_run_messages transcript) and add a
--      CHECK constraint that enforces UUID shape, so a malformed insert
--      fails loudly rather than silently polluting the feedback loop.

-- ---------------------------------------------------------------------------
-- feature_requests — DB-level uniqueness on dedupe key
-- ---------------------------------------------------------------------------
--
-- Partial unique index so two rows for the same (org, category, dedupe_hash)
-- cannot coexist while both are not-soft-deleted. The request_feature skill
-- also takes an advisory lock for performance — this index is the
-- correctness backstop when the lock race window opens.

CREATE UNIQUE INDEX IF NOT EXISTS feature_requests_dedupe_unique_idx
  ON feature_requests (organisation_id, category, dedupe_hash)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- routing_outcomes — decision_record_id format contract
-- ---------------------------------------------------------------------------
--
-- decision_record_id is the uuid generated at the top of each Orchestrator
-- routing run, written into the agent_run_messages transcript with
-- messageType='routing_decision'. It has no FK constraint because the
-- decision record lives in a free-form jsonb column, not a dedicated table.
-- The CHECK below validates the uuid shape so a malformed id fails fast.

ALTER TABLE routing_outcomes
  ADD CONSTRAINT routing_outcomes_decision_record_id_uuid_format
  CHECK (decision_record_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
