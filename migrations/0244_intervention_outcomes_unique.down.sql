DROP INDEX IF EXISTS intervention_outcomes_intervention_unique;
CREATE INDEX IF NOT EXISTS intervention_outcomes_intervention_idx
  ON intervention_outcomes (intervention_id);
