-- Migration 0099: add merge_updated_at to skill_analyzer_results
--
-- Supports optimistic concurrency on the PATCH /merge endpoint (Phase 5).
-- Set by patchMergeFields and resetMergeToOriginal on every merge write.
-- The client echoes back the value it last saw; the service rejects with 409
-- if the stored timestamp is newer than the client's copy.
--
-- Nullable: existing rows have no merge history so the guard doesn't apply
-- until the first write. The service skips the check when the column is NULL.

ALTER TABLE skill_analyzer_results
  ADD COLUMN merge_updated_at timestamptz;
