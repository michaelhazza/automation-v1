-- Reverse 0190 — drop the llm_requests_started_idx partial index.
-- Does not purge existing `status = 'started'` rows; they'll simply be
-- aged out by the sweep job (which reads the schema's status column by
-- name, not by index).

DROP INDEX IF EXISTS llm_requests_started_idx;
