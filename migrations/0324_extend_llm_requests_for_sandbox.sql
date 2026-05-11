-- Migration 0324: Extend llm_requests for sandbox compute cost rows
-- Spec §12.2, §12.3, §12.4, §12.5, §19.4, §24.1.
--
-- Three operations (per plan):
--   1. Add six nullable columns for sandbox compute attribution.
--   2. Extend the attribution CHECK constraint (from 0185_llm_requests_generalisation.sql)
--      with two new source_type branches: 'sandbox_compute' and 'sandbox_compute_correction'.
--      Also extend the execution_phase CHECK constraint to allow NULL for sandbox rows.
--   3. Add two partial unique indexes for harvest-pipeline idempotency (spec §24.1).
--
-- The original constraint body from 0185 is reproduced in full so the extension is
-- self-contained and auditable without cross-referencing the earlier migration.

BEGIN;

-- ── 1. Column additions ────────────────────────────────────────────────────────
ALTER TABLE llm_requests
  ADD COLUMN sandbox_execution_id     UUID,
  ADD COLUMN sandbox_vcpu_seconds     NUMERIC(12, 4),
  ADD COLUMN sandbox_wall_clock_ms    INTEGER,
  ADD COLUMN sandbox_provider         TEXT,
  ADD COLUMN sandbox_template_version TEXT,
  ADD COLUMN correction_sequence      INTEGER;

-- ── 2a. Extend attribution CHECK constraint ────────────────────────────────────
--
-- Original branches from 0185 (agent_run, process_execution, iee, analyzer, system)
-- plus two new sandbox branches.
ALTER TABLE llm_requests DROP CONSTRAINT llm_requests_attribution_ck;
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
  OR
  (source_type = 'sandbox_compute'
     AND sandbox_execution_id     IS NOT NULL
     AND sandbox_vcpu_seconds     IS NOT NULL
     AND sandbox_wall_clock_ms    IS NOT NULL
     AND sandbox_provider         IS NOT NULL
     AND sandbox_template_version IS NOT NULL)
  OR
  (source_type = 'sandbox_compute_correction'
     AND sandbox_execution_id IS NOT NULL
     AND correction_sequence  IS NOT NULL)
);

-- ── 2b. Extend execution_phase CHECK constraint ────────────────────────────────
--
-- Original from 0185: execution_phase IS NULL iff source_type IN ('system','analyzer').
-- Sandbox rows also have NULL execution_phase (they are not agent-run phases).
ALTER TABLE llm_requests DROP CONSTRAINT llm_requests_execution_phase_ck;
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_execution_phase_ck CHECK (
  (source_type IN ('agent_run', 'process_execution', 'iee') AND execution_phase IS NOT NULL)
  OR
  (source_type IN ('system', 'analyzer', 'sandbox_compute', 'sandbox_compute_correction') AND execution_phase IS NULL)
);

-- ── 3. Partial unique indexes for harvest-pipeline idempotency ─────────────────
--
-- One cost row per sandbox execution (primary harvest write). Caller catches
-- 23505 on this index and reads back canonical via getExecution (spec §24.6).
CREATE UNIQUE INDEX llm_requests_sandbox_execution_id_unique_idx ON llm_requests (sandbox_execution_id) WHERE source_type = 'sandbox_compute';

-- One correction row per (execution, sequence). Caller re-allocates correction_sequence
-- and retries on 23505 (spec §24.6).
CREATE UNIQUE INDEX llm_requests_sandbox_correction_sequence_unique_idx ON llm_requests (sandbox_execution_id, correction_sequence) WHERE source_type = 'sandbox_compute_correction';

COMMIT;
