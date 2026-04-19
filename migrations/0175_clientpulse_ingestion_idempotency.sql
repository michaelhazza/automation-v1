-- 0175_clientpulse_ingestion_idempotency.sql
-- ClientPulse Phase 1 follow-up: prevent duplicate signal observation rows
-- when a poll cycle is retried (pg-boss retry, manual re-run, etc.).
--
-- Partial UNIQUE index on (organisation_id, subaccount_id, signal_slug,
-- source_run_id) WHERE source_run_id IS NOT NULL. The partial predicate
-- allows historical rows with NULL source_run_id to continue to exist, and
-- ensures every new write (which always populates source_run_id) is unique
-- within a single poll run. Cross-poll duplicates remain permitted — the
-- observations table is a timeseries by design.
--
-- Paired with onConflictDoNothing() in clientPulseIngestionService so
-- retries are no-ops rather than errors.

BEGIN;

CREATE UNIQUE INDEX client_pulse_signal_observations_poll_run_unique
  ON client_pulse_signal_observations (organisation_id, subaccount_id, signal_slug, source_run_id)
  WHERE source_run_id IS NOT NULL;

COMMIT;
