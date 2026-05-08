-- 0293_bench_runs.sql
-- Trust & Verification Layer — Chunk 6, spec §6.6, §7, §12.2
--
-- Creates bench_runs + bench_results: operator-triggered model comparison
-- with cost estimation and per-result outcomes.
-- Tenant-isolated via canonical org-isolation RLS policy on both tables.

CREATE TABLE IF NOT EXISTS bench_runs (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id         uuid        NOT NULL REFERENCES organisations (id),
  triggered_by_user_id    uuid        NOT NULL REFERENCES users (id),
  target_agent_id         uuid        REFERENCES agents (id),
  target_skill_slug       text,
  state                   text        NOT NULL DEFAULT 'pending'
    CONSTRAINT bench_runs_state_check
      CHECK (state IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  candidate_model_ids     jsonb       NOT NULL DEFAULT '[]',
  sample_count            integer     NOT NULL DEFAULT 10,
  estimated_cost_cents    integer,
  actual_cost_cents       integer,
  started_at              timestamptz,
  completed_at            timestamptz,
  failure_reason          text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: prevent duplicate bench runs triggered by the same user for the
-- same target within the same minute. Cannot live inside CREATE TABLE as a
-- table-level UNIQUE constraint because PostgreSQL does not allow expressions
-- (date_trunc) in table-level UNIQUE constraints.
CREATE UNIQUE INDEX bench_runs_user_target_minute_uniq
  ON bench_runs (
    triggered_by_user_id,
    target_agent_id,
    target_skill_slug,
    date_trunc('minute', created_at)
  );

CREATE TABLE IF NOT EXISTS bench_results (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id     uuid        NOT NULL REFERENCES organisations (id),
  bench_run_id        uuid        NOT NULL REFERENCES bench_runs (id),
  candidate_model_id  text        NOT NULL,
  sample_index        integer     NOT NULL,
  verdict             text
    CONSTRAINT bench_results_verdict_check
      CHECK (verdict IN ('pass', 'fail', 'inconclusive', 'error')),
  score               real,
  reasoning           text,
  latency_ms          integer,
  cost_cents          integer,
  raw_output          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bench_results_run_model_sample_uniq
    UNIQUE (bench_run_id, candidate_model_id, sample_index)
);

CREATE INDEX bench_runs_org_idx          ON bench_runs (organisation_id);
CREATE INDEX bench_runs_user_idx         ON bench_runs (triggered_by_user_id);
CREATE INDEX bench_results_org_idx       ON bench_results (organisation_id);
CREATE INDEX bench_results_bench_run_idx ON bench_results (bench_run_id);

-- RLS — canonical org-isolation policy on bench_runs
ALTER TABLE bench_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bench_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bench_runs_org_isolation ON bench_runs;
CREATE POLICY bench_runs_org_isolation ON bench_runs
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

-- RLS — canonical org-isolation policy on bench_results
ALTER TABLE bench_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE bench_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bench_results_org_isolation ON bench_results;
CREATE POLICY bench_results_org_isolation ON bench_results
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
