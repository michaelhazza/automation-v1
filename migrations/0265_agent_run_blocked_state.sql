-- Add integration-block state columns to agent_runs
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS blocked_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS integration_resume_token TEXT NULL,
  ADD COLUMN IF NOT EXISTS integration_dedup_key TEXT NULL;

COMMENT ON COLUMN agent_runs.blocked_reason IS 'Set to ''integration_required'' when the run is paused waiting for an OAuth connection. NULL = not blocked.';
COMMENT ON COLUMN agent_runs.integration_resume_token IS 'SHA-256 hash of the plaintext bearer token. Plaintext lives only in agent_messages.meta.resumeToken.';

CREATE INDEX IF NOT EXISTS agent_runs_blocked_expiry_idx
  ON agent_runs (blocked_expires_at)
  WHERE blocked_reason IS NOT NULL;

-- Add meta JSONB column to agent_messages for typed UI extensions
ALTER TABLE agent_messages
  ADD COLUMN IF NOT EXISTS meta JSONB NULL;

COMMENT ON COLUMN agent_messages.meta IS 'Typed UI extension metadata. Discriminated union on meta.kind. See shared/types/integrationCardContent.ts';
