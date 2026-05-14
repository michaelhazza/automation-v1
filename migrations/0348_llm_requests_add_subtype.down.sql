ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_warm_session_id_check;
ALTER TABLE llm_requests DROP CONSTRAINT IF EXISTS llm_requests_subtype_check;
ALTER TABLE llm_requests DROP COLUMN IF EXISTS warm_session_id;
ALTER TABLE llm_requests DROP COLUMN IF EXISTS subtype;
