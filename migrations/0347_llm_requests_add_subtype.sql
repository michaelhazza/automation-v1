-- Migration 0347: Add subtype + warm_session_id columns to llm_requests
--
-- These columns support the IEE-browser cost-row discriminator (spec §8.6).
-- subtype: 'task' | 'warm_pool' when source_type = 'sandbox_compute'; NULL otherwise.
-- warm_session_id: UUID of the warm session row; non-null only when subtype = 'warm_pool'.
--
-- NOTE: NO FK on warm_session_id yet — the target table browser_warm_sessions is
-- created in migration 0348. FK + unique partial index land in migration 0349.
--
-- CHECK constraints use IS DISTINCT FROM (not =) for null-safe three-valued-logic.
-- Existing rows have NULL for both columns — constraints hold trivially.

ALTER TABLE llm_requests ADD COLUMN subtype TEXT;
ALTER TABLE llm_requests ADD COLUMN warm_session_id UUID;

-- CHECK 1: subtype enum gate (null-safe)
-- When source_type = 'sandbox_compute', subtype must be 'task' or 'warm_pool'.
-- When source_type is anything else (including NULL), subtype must be NULL.
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_subtype_check CHECK (
  (source_type = 'sandbox_compute' AND subtype IN ('task', 'warm_pool'))
  OR (source_type IS DISTINCT FROM 'sandbox_compute' AND subtype IS NULL)
);

-- CHECK 2: warm_session_id consistency (null-safe)
-- warm_session_id must be non-null if and only if subtype = 'warm_pool'.
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_warm_session_id_check CHECK (
  (subtype = 'warm_pool' AND warm_session_id IS NOT NULL)
  OR (subtype IS DISTINCT FROM 'warm_pool' AND warm_session_id IS NULL)
);
