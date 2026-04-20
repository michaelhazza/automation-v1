-- Reverse 0189 — drop the llm_requests_all view.
-- The view is non-destructive (CREATE OR REPLACE), so no data risk.

DROP VIEW IF EXISTS llm_requests_all;
