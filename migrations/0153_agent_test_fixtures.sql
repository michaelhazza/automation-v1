-- Migration 0153 — agent_test_fixtures
-- Feature 2: test-input fixtures for the inline Run-Now test panel.
-- See docs/routines-response-dev-spec.md §9.

CREATE TABLE IF NOT EXISTS agent_test_fixtures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES organisations(id),
  subaccount_id   uuid        REFERENCES subaccounts(id),
  scope           text        NOT NULL CHECK (scope IN ('agent', 'skill')),
  target_id       uuid        NOT NULL,
  label           text        NOT NULL,
  input_json      jsonb       NOT NULL,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS agent_test_fixtures_target_idx
  ON agent_test_fixtures (organisation_id, scope, target_id)
  WHERE deleted_at IS NULL;

-- RLS: tenant isolation keyed on app.organisation_id
ALTER TABLE agent_test_fixtures ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_test_fixtures_org_isolation
  ON agent_test_fixtures
  USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
