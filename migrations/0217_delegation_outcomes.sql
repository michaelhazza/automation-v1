CREATE TABLE delegation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  caller_agent_id uuid NOT NULL REFERENCES subaccount_agents(id) ON DELETE CASCADE,
  target_agent_id uuid NOT NULL REFERENCES subaccount_agents(id) ON DELETE CASCADE,
  delegation_scope text NOT NULL,
  outcome text NOT NULL,
  reason text,
  delegation_direction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delegation_outcomes_scope_chk
    CHECK (delegation_scope IN ('children', 'descendants', 'subaccount')),
  CONSTRAINT delegation_outcomes_outcome_chk
    CHECK (outcome IN ('accepted', 'rejected')),
  CONSTRAINT delegation_outcomes_reason_chk
    CHECK (
      (outcome = 'accepted' AND reason IS NULL)
      OR (outcome = 'rejected' AND reason IS NOT NULL)
    ),
  CONSTRAINT delegation_outcomes_direction_chk
    CHECK (delegation_direction IN ('down', 'up', 'lateral'))
);

CREATE INDEX delegation_outcomes_org_created_idx
  ON delegation_outcomes (organisation_id, created_at DESC);

CREATE INDEX delegation_outcomes_caller_created_idx
  ON delegation_outcomes (caller_agent_id, created_at DESC);

CREATE INDEX delegation_outcomes_run_idx
  ON delegation_outcomes (run_id);

ALTER TABLE delegation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_outcomes FORCE ROW LEVEL SECURITY;

CREATE POLICY delegation_outcomes_org_isolation ON delegation_outcomes
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
