-- 0238_system_incidents_last_triage_job_id
--
-- Adds last_triage_job_id text column to system_incidents to support
-- key-based idempotency on triage_attempt_count increments. The handler
-- updates this column atomically with the increment via a predicate of
-- the form `WHERE last_triage_job_id IS DISTINCT FROM $jobId`, which
-- causes pg-boss internal retries (same job UUID) to no-op rather than
-- inflating the counter.
--
-- See spec §4.1, §4.2 for the contract. Operators do not consume this
-- column; it is internal to the increment predicate.

ALTER TABLE system_incidents
  ADD COLUMN last_triage_job_id text;

-- No backfill needed: NULL is the correct "no attempt yet" state, and
-- the IS DISTINCT FROM predicate correctly fires the first increment
-- when the column is NULL and the candidate jobId is not.
