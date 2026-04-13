-- Migration 0109: add classificationFailed + classificationFailureReason to skill_analyzer_results
--
-- Tracks API-level failure during the classify stage (Phase 3). The boolean
-- classificationFailed is set to true only when the LLM call failed (429,
-- parse error) — NOT for genuine PARTIAL_OVERLAP results. This
-- distinguishes retryable failures from model output.
--
-- classificationFailureReason stores the failure type:
-- 'rate_limit' | 'parse_error' | 'unknown'.
-- Null on all rows where classificationFailed is false.

ALTER TABLE skill_analyzer_results
  ADD COLUMN classification_failed boolean DEFAULT false NOT NULL;

ALTER TABLE skill_analyzer_results
  ADD COLUMN classification_failure_reason text;
