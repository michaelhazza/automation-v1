-- Migration 0185 — LLM observability & ledger generalisation (Phase 1)
--
-- Adds four new columns to llm_requests so non-agent consumers (skill analyzer,
-- workspace-memory compile, belief extraction, future background jobs) can
-- plug into the router-enforced ledger without adding a typed FK per consumer:
--
--   source_id                uuid       — polymorphic FK (no referential integrity)
--   feature_tag              text       — kebab-case feature identifier (e.g. 'skill-analyzer-classify')
--   parse_failure_raw_excerpt text      — ≤2 KB truncated LLM response on parse failure
--   abort_reason             text       — 'caller_timeout' | 'caller_cancel' | NULL
--
-- Loosens execution_phase to nullable so non-agent callers (sourceType IN
-- ('system','analyzer')) don't have to fabricate a bogus enum value.
--
-- Drops the sourceType default — every insert path must specify source_type
-- explicitly so the CHECK constraint below can't be satisfied by accident.
--
-- Adds two CHECK constraints:
--   llm_requests_attribution_ck      — enforces the polymorphic attribution
--                                      invariant from spec §5.1 / §6.1
--   llm_requests_execution_phase_ck  — enforces NULL execution_phase iff
--                                      source_type IN ('system','analyzer')
--
-- Adds three indexes:
--   llm_requests_source_id_idx            — partial, source_id IS NOT NULL
--   llm_requests_feature_tag_month_idx    — (feature_tag, billing_month)
--   llm_requests_status_idx               — partial, status <> 'success'
--
-- Pre-production: immediate CHECK validation (no NOT VALID / deferred
-- VALIDATE CONSTRAINT). If an existing row violates, the migration fails
-- cleanly and we fix forward.

BEGIN;

-- ── Column additions ───────────────────────────────────────────────────────
ALTER TABLE llm_requests
  ADD COLUMN source_id                 uuid,
  ADD COLUMN feature_tag               text NOT NULL DEFAULT 'unknown',
  ADD COLUMN parse_failure_raw_excerpt text,
  ADD COLUMN abort_reason              text;

-- ── Loosen execution_phase ────────────────────────────────────────────────
ALTER TABLE llm_requests ALTER COLUMN execution_phase DROP NOT NULL;
ALTER TABLE llm_requests ALTER COLUMN execution_phase DROP DEFAULT;

-- ── Drop source_type default ───────────────────────────────────────────────
ALTER TABLE llm_requests ALTER COLUMN source_type DROP DEFAULT;

-- ── Attribution invariant ──────────────────────────────────────────────────
--
-- Every row must fall into exactly one of:
--   agent_run          → runId set, other FKs null, source_id null
--   process_execution  → executionId set, other FKs null, source_id null
--   iee                → ieeRunId set, other FKs null, source_id null
--   analyzer           → source_id set, all typed FKs null
--   system             → all typed FKs null (source_id optional)
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_attribution_ck CHECK (
  (source_type = 'agent_run'
     AND run_id          IS NOT NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'process_execution'
     AND execution_id    IS NOT NULL
     AND run_id          IS NULL
     AND iee_run_id      IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'iee'
     AND iee_run_id      IS NOT NULL
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'analyzer'
     AND source_id       IS NOT NULL
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL)
  OR
  (source_type = 'system'
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL)
);

-- ── execution_phase nullability invariant ─────────────────────────────────
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_execution_phase_ck CHECK (
  (source_type IN ('agent_run', 'process_execution', 'iee') AND execution_phase IS NOT NULL)
  OR
  (source_type IN ('system', 'analyzer') AND execution_phase IS NULL)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX llm_requests_source_id_idx
  ON llm_requests (source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX llm_requests_feature_tag_month_idx
  ON llm_requests (feature_tag, billing_month);

CREATE INDEX llm_requests_status_idx
  ON llm_requests (status)
  WHERE status <> 'success';

COMMIT;
