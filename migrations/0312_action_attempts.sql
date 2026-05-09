CREATE TABLE action_attempts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID         NOT NULL REFERENCES organisations(id),
  connector_config_id  UUID         NOT NULL REFERENCES connector_configs(id),
  idempotency_key      TEXT         NOT NULL,
  action_type          TEXT         NOT NULL CHECK (action_type IN ('reply','internal_note','status_change','assignment_change','tag_change')),
  attempt_status       TEXT         NOT NULL CHECK (attempt_status IN ('in_flight','succeeded','failed')),
  attempted_at         TIMESTAMP WITH TIME ZONE NOT NULL,
  succeeded_at         TIMESTAMP WITH TIME ZONE,
  provider_response_id TEXT,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT action_attempts_connector_idempotency_unique UNIQUE (connector_config_id, idempotency_key)
);

CREATE INDEX action_attempts_org_status_attempted_idx
  ON action_attempts (organisation_id, attempt_status, attempted_at);

ALTER TABLE action_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_attempts_org_isolation ON action_attempts;
CREATE POLICY action_attempts_org_isolation ON action_attempts
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
