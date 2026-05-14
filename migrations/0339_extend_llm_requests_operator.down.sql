-- Down migration for 0339_extend_llm_requests_operator.sql

DROP INDEX IF EXISTS llm_requests_operator_run_source_boundary_unique_idx;
DROP INDEX IF EXISTS llm_requests_operator_run_id_idx;

ALTER TABLE llm_requests
  DROP COLUMN IF EXISTS boundary,
  DROP COLUMN IF EXISTS operator_run_id;
