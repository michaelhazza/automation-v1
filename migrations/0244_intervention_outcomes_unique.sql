-- Replace the non-unique index with a UNIQUE index on intervention_id.
-- The existing non-unique index is named intervention_outcomes_intervention_idx
-- (per server/db/schema/interventionOutcomes.ts) and was added by an earlier
-- migration; the unique replacement enforces exactly-once write semantics for
-- measureInterventionOutcomeJob.
--
-- §4.2.0 pre-check: implementer has confirmed either zero pre-existing
-- duplicates OR has applied a deterministic, reviewer-vetted dedup rule
-- (recorded in tasks/builds/pre-prod-tenancy/progress.md). The migration
-- below assumes that pre-check has happened; it does NOT default to a
-- ctid-based dedup. If duplicates exist at apply time without a vetted
-- rule, the LOCK + CREATE UNIQUE INDEX path below will fail loudly and
-- roll back — the correct outcome.

-- Acquire ACCESS EXCLUSIVE on the table for the migration's duration.
LOCK TABLE intervention_outcomes IN ACCESS EXCLUSIVE MODE;

DROP INDEX IF EXISTS intervention_outcomes_intervention_idx;
CREATE UNIQUE INDEX intervention_outcomes_intervention_unique
  ON intervention_outcomes (intervention_id);
