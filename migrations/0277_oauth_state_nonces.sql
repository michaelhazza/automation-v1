-- system-scoped: pre-auth OAuth state, no organisation_id available pre-callback
CREATE TABLE oauth_state_nonces (
  nonce            text        PRIMARY KEY,
  organisation_id  uuid        NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_state_nonces_expires ON oauth_state_nonces (expires_at);
