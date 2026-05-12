-- Migration 0331: Extend llm_requests for the operator_managed backend
--
-- Adds two columns to the llm_requests ledger:
--   - operator_run_id: FK to operator_runs(id), populated for
--     subscription_mediated and sandbox_compute rows written by the operator
--     backend cost-writer (spec §4.10).
--   - boundary: text token identifying the cost-accounting boundary within a
--     chain link (e.g. 'pre_fallback' / 'post_fallback' for mid-run swap
--     accounting). Used as part of the idempotency key for operator rows.
--
-- Also adds:
--   - Partial UNIQUE index on (operator_run_id, source_type, boundary) for
--     operator-cost idempotency.
--   - Covering index on (operator_run_id) for per-chain-link cost reads.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §4.10, §3.12

ALTER TABLE llm_requests
  ADD COLUMN IF NOT EXISTS operator_run_id  uuid REFERENCES operator_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boundary         text;

-- Covering index for per-chain-link cost reads
CREATE INDEX IF NOT EXISTS llm_requests_operator_run_id_idx ON llm_requests (operator_run_id)
  WHERE operator_run_id IS NOT NULL;

-- Partial UNIQUE index for operator-cost idempotency (spec §3.12 / §4.10)
-- One row per (operator_run, source_type, boundary) when both are set.
CREATE UNIQUE INDEX IF NOT EXISTS llm_requests_operator_run_source_boundary_unique_idx
  ON llm_requests (operator_run_id, source_type, boundary)
  WHERE operator_run_id IS NOT NULL AND boundary IS NOT NULL;
