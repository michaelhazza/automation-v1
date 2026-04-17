-- migrations/0165_p3a_agent_runs_principal.sql
-- P3A: Add principal-model fields to agent_runs.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS principal_type text NOT NULL DEFAULT 'user'
    CHECK (principal_type IN ('user','service','delegated')),
  ADD COLUMN IF NOT EXISTS principal_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acting_as_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delegation_grant_id uuid;

CREATE INDEX IF NOT EXISTS agent_runs_principal_idx
  ON agent_runs (principal_type, principal_id);

-- Backfill
UPDATE agent_runs SET principal_type = 'user', principal_id = user_id::text
  WHERE user_id IS NOT NULL AND principal_id = '';
UPDATE agent_runs SET principal_type = 'service', principal_id = 'service:unknown-legacy'
  WHERE user_id IS NULL AND principal_id = '';
