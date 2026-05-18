-- Migration 0371: Extend llm_requests CHECK constraints for failure_post_mortem source_type
-- Closed-Loop Skill Improvement spec §9.1 (Chunk 4).
--
-- Two operations:
--   1. Extend the attribution CHECK constraint (llm_requests_attribution_ck) with a new
--      source_type branch: 'failure_post_mortem'. Mirrors the pattern migration 0324 used
--      for 'sandbox_compute'. The full constraint body from 0324 is reproduced so this
--      migration is self-contained and auditable without cross-referencing earlier migrations.
--   2. Extend the execution_phase CHECK constraint (llm_requests_execution_phase_ck) to
--      allow NULL execution_phase for 'failure_post_mortem' rows (same pattern as 'system').
--
-- Note: TASK_TYPES ('peer_review') has no DB CHECK constraint — it is enforced by the Zod
-- enum in server/db/schema/llmRequests.ts only. No DDL change needed for task_type.

BEGIN;

-- ── 1. Extend attribution CHECK constraint ─────────────────────────────────────
--
-- Reproduces all branches from 0185 + 0324 plus the new 'failure_post_mortem' branch.
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
  OR
  (source_type = 'failure_post_mortem'
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL)
);

-- ── 2. Extend execution_phase CHECK constraint ─────────────────────────────────
--
-- Original from 0185: execution_phase IS NULL iff source_type IN ('system','analyzer').
-- 0324 extended this to include 'sandbox_compute' and 'sandbox_compute_correction'.
-- This migration adds 'failure_post_mortem' to the NULL-phase set (not an agent-run phase).
ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_execution_phase_ck;
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_execution_phase_ck CHECK (
  (source_type IN ('agent_run', 'process_execution', 'iee') AND execution_phase IS NOT NULL)
  OR
  (source_type IN ('system', 'analyzer', 'sandbox_compute', 'sandbox_compute_correction', 'failure_post_mortem') AND execution_phase IS NULL)
);

COMMIT;
