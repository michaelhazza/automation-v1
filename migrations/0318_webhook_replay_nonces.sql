CREATE TABLE webhook_replay_nonces (
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  webhook_source text NOT NULL,
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_replay_nonces_org_source_nonce_unique UNIQUE (organisation_id, webhook_source, nonce)
);

CREATE INDEX ON webhook_replay_nonces (organisation_id, webhook_source, seen_at);

ALTER TABLE webhook_replay_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_replay_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_replay_nonces_org_isolation ON webhook_replay_nonces
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
