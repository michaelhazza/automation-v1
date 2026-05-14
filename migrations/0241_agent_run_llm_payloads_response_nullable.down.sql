-- Reverts migration 0241. Restores the NOT NULL constraint on
-- agent_run_llm_payloads.response. Any rows with null `response` MUST be
-- backfilled to a sentinel JSON value before this down migration is run;
-- otherwise the ALTER TABLE will fail.
BEGIN;
ALTER TABLE agent_run_llm_payloads ALTER COLUMN response SET NOT NULL;
COMMIT;
