-- migration 0315: support_eval_runs
-- Additive only (INV-5). Down migration at migrations/_down/0315_support_eval_runs.down.sql

CREATE TABLE IF NOT EXISTS support_eval_runs (
  id                                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                      uuid NOT NULL REFERENCES organisations(id),
  run_at                               timestamptz NOT NULL DEFAULT now(),
  classification_accuracy_per_intent   jsonb NOT NULL,
  draft_judge_score_avg                numeric(4,2) NOT NULL,
  threshold_classification_min         numeric(4,2) NOT NULL,
  threshold_judge_min                  numeric(4,2) NOT NULL,
  prompt_version                       integer NOT NULL,
  model_id                             text NOT NULL,
  skill_template_hashes                jsonb NOT NULL,
  row_count                            integer NOT NULL,
  partial                              boolean NOT NULL DEFAULT false
);

CREATE INDEX support_eval_runs_org_run_at_idx
  ON support_eval_runs (organisation_id, run_at DESC);

ALTER TABLE support_eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_eval_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON support_eval_runs
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
