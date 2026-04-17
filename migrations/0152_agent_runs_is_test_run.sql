-- migrations/0152_agent_runs_is_test_run.sql
-- Feature 2 (Inline Run Now test UX) / Feature 1 dependency
-- (docs/routines-response-dev-spec.md §4.4 / §3.6 step 6)
--
-- Adds the `is_test_run` classifier column to agent_runs so that:
--
--   - The Scheduled Runs Calendar's cost estimator can exclude test runs when
--     averaging historical runs (else a test-run token count can skew forward
--     projections low).
--   - The LLM usage explorer, agent-run list, and Agency P&L aggregates can
--     apply `WHERE is_test_run = false` by default (see spec §4.7 exclusion
--     matrix).
--
-- Column is NOT NULL with a DEFAULT false so every existing row is correctly
-- classified as a production run without a backfill step. No index is added;
-- the filter is always paired with existing org/subaccount indexes and the
-- selectivity is high enough that an additional index would not pay off.

ALTER TABLE agent_runs
  ADD COLUMN is_test_run BOOLEAN NOT NULL DEFAULT FALSE;
