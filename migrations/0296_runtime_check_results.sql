-- 0296_runtime_check_results.sql
-- Trust & Verification Layer — Chunk 1, spec §6.2, §7, §10.1
--
-- Creates runtime_check_results: per-step verification verdicts with
-- blast-radius and reversibility metadata. Tenant-isolated via RLS.
--
-- Idempotency key: UNIQUE (run_id, sequence_number, skill_slug, attempt_number)
-- — prevents duplicate verdicts on retry (§10.1).

CREATE TABLE IF NOT EXISTS runtime_check_results (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id         uuid        NOT NULL REFERENCES organisations (id),
  subaccount_id           uuid        REFERENCES subaccounts (id),
  run_id                  uuid        NOT NULL REFERENCES agent_runs (id),
  event_id                uuid        REFERENCES agent_execution_events (id),
  sequence_number         integer     NOT NULL,
  skill_slug              text        NOT NULL,
  attempt_number          integer     NOT NULL DEFAULT 1,
  state                   text        NOT NULL
    CONSTRAINT runtime_check_results_state_check
      CHECK (state IN ('pass', 'fail', 'inconclusive', 'pending', 'not_applicable')),
  reason_code             text        NOT NULL,
  reason_text             text        NOT NULL,
  impact                  text        NOT NULL
    CONSTRAINT runtime_check_results_impact_check
      CHECK (impact IN ('blocking', 'informational')),
  suggested_fix           text,
  evaluated_at            timestamptz NOT NULL DEFAULT now(),
  blast_radius            text        NOT NULL
    CONSTRAINT runtime_check_results_blast_radius_check
      CHECK (blast_radius IN ('self', 'tenant', 'external')),
  reversible              boolean     NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT runtime_check_results_run_seq_skill_attempt_uniq
    UNIQUE (run_id, sequence_number, skill_slug, attempt_number)
);

-- Lookup indexes
CREATE INDEX runtime_check_results_org_idx
  ON runtime_check_results (organisation_id);

CREATE INDEX runtime_check_results_run_idx
  ON runtime_check_results (run_id);

-- RLS — canonical org-isolation policy (matches 0079 template)
ALTER TABLE runtime_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_check_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runtime_check_results_org_isolation ON runtime_check_results;
CREATE POLICY runtime_check_results_org_isolation ON runtime_check_results
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
