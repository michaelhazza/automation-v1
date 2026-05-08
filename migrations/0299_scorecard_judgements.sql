-- 0299_scorecard_judgements.sql
-- Trust & Verification Layer — Chunk 6, spec §6.5, §7, §10.6
--
-- Creates scorecard_judgements: per-(run, scorecard, quality-check, trigger)
-- LLM grading verdicts. Five F1 snapshot fields preserve the rubric state
-- at judgement time for audit and regression analysis.
-- Tenant-isolated via canonical org-isolation RLS policy.

CREATE TABLE IF NOT EXISTS scorecard_judgements (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id       uuid        NOT NULL REFERENCES organisations (id),
  run_id                uuid        NOT NULL REFERENCES agent_runs (id),
  scorecard_id          uuid        NOT NULL REFERENCES scorecards (id),
  quality_check_slug    text        NOT NULL,
  trigger_source        text        NOT NULL
    CONSTRAINT scorecard_judgements_trigger_check
      CHECK (trigger_source IN ('sampled', 'forced', 'bench')),

  -- Verdict
  verdict               text        NOT NULL
    CONSTRAINT scorecard_judgements_verdict_check
      CHECK (verdict IN ('pass', 'fail', 'inconclusive')),
  score                 real,                             -- 0.0–1.0, NULL when inconclusive
  reasoning             text,

  -- F1 snapshot fields — rubric state at judgement time
  snapshot_scorecard_name      text        NOT NULL,
  snapshot_quality_check_name  text        NOT NULL,
  snapshot_quality_check_desc  text,
  snapshot_judge_model_id      text        NOT NULL,
  snapshot_rubric_version      integer     NOT NULL DEFAULT 1,

  judged_at             timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scorecard_judgements_run_scorecard_check_trigger_uniq
    UNIQUE (run_id, scorecard_id, quality_check_slug, trigger_source)
);

CREATE INDEX scorecard_judgements_org_idx      ON scorecard_judgements (organisation_id);
CREATE INDEX scorecard_judgements_run_idx      ON scorecard_judgements (run_id);
CREATE INDEX scorecard_judgements_scorecard_idx ON scorecard_judgements (scorecard_id);

-- RLS — canonical org-isolation policy (matches 0079 template)
ALTER TABLE scorecard_judgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_judgements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scorecard_judgements_org_isolation ON scorecard_judgements;
CREATE POLICY scorecard_judgements_org_isolation ON scorecard_judgements
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
