DROP INDEX IF EXISTS llm_requests_warm_session_id_unique_idx;
ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_warm_session_id_fk;
