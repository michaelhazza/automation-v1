-- Down migration for 0324_extend_llm_requests_for_sandbox.sql
-- Reverses operations in reverse order: indexes → constraints → columns.

BEGIN;

-- ── 3 (reversed). Drop partial unique indexes ──────────────────────────────────
DROP INDEX IF EXISTS llm_requests_sandbox_correction_sequence_unique_idx;
DROP INDEX IF EXISTS llm_requests_sandbox_execution_id_unique_idx;

-- ── 2b (reversed). Restore execution_phase CHECK to pre-0324 shape ────────────
ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_execution_phase_ck;
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_execution_phase_ck CHECK (
  (source_type IN ('agent_run', 'process_execution', 'iee') AND execution_phase IS NOT NULL)
  OR
  (source_type IN ('system', 'analyzer') AND execution_phase IS NULL)
);

-- ── 2a (reversed). Restore attribution CHECK to pre-0324 shape ────────────────
ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_attribution_ck;
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

-- ── 1 (reversed). Drop the six sandbox columns ────────────────────────────────
ALTER TABLE llm_requests
  DROP COLUMN IF EXISTS correction_sequence,
  DROP COLUMN IF EXISTS sandbox_template_version,
  DROP COLUMN IF EXISTS sandbox_provider,
  DROP COLUMN IF EXISTS sandbox_wall_clock_ms,
  DROP COLUMN IF EXISTS sandbox_vcpu_seconds,
  DROP COLUMN IF EXISTS sandbox_execution_id;

COMMIT;
