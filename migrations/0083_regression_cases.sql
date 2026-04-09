-- 0083_regression_cases.sql
--
-- Sprint 2 — P1.2 HITL rejection → automatic regression test capture.
-- Creates the regression_cases table, adds agents.regression_case_cap
-- override, and enables RLS in line with Sprint 2 P1.1 Layer 1.
--
-- Contract: docs/improvements-roadmap-spec.md §P1.2.

-- ---------------------------------------------------------------------------
-- regression_cases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regression_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_review_item_id uuid REFERENCES review_items(id) ON DELETE SET NULL,

  -- Materialised capture payload
  input_contract_json jsonb NOT NULL,
  rejected_call_json jsonb NOT NULL,
  rejection_reason text,
  input_contract_hash text NOT NULL,
  rejected_call_hash text NOT NULL,

  status text NOT NULL DEFAULT 'active',
  last_replayed_at timestamptz,
  last_replay_result text,
  consecutive_passes integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT regression_cases_status_check
    CHECK (status IN ('active', 'retired', 'stale')),
  CONSTRAINT regression_cases_last_replay_result_check
    CHECK (last_replay_result IS NULL OR last_replay_result IN ('pass', 'fail', 'skipped'))
);

CREATE INDEX IF NOT EXISTS regression_cases_agent_status_idx
  ON regression_cases (agent_id, status);

CREATE INDEX IF NOT EXISTS regression_cases_org_idx
  ON regression_cases (organisation_id);

CREATE INDEX IF NOT EXISTS regression_cases_source_run_idx
  ON regression_cases (source_agent_run_id);

CREATE INDEX IF NOT EXISTS regression_cases_call_hash_idx
  ON regression_cases (rejected_call_hash);

-- ---------------------------------------------------------------------------
-- agents.regression_case_cap — per-agent override for the ring buffer size.
-- NULL = use DEFAULT_REGRESSION_CASE_CAP from server/config/limits.ts.
-- ---------------------------------------------------------------------------

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS regression_case_cap integer;

-- ---------------------------------------------------------------------------
-- Row Level Security — Sprint 2 P1.1 Layer 1 policy shape (see 0079).
-- regression_cases is tenant-owned: a leak would expose another org's
-- rejected-behaviour list, which is sensitive because it reveals the
-- reviewer's framing of what the agent should never do.
-- ---------------------------------------------------------------------------

ALTER TABLE regression_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE regression_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS regression_cases_org_isolation ON regression_cases;
CREATE POLICY regression_cases_org_isolation ON regression_cases
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
