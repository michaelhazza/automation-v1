-- migrations/0165_p3a_agent_runs_principal.sql
-- P3A: Add principal-model fields to agent_runs.
--
-- Note: agent_runs has never had a user_id column — historical runs carry no
-- direct user attribution at the row level. All legacy rows are therefore
-- backfilled as 'service:unknown-legacy'. New runs populate principal_type /
-- principal_id at creation time from the request's authenticated principal.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS principal_type text NOT NULL DEFAULT 'user'
    CHECK (principal_type IN ('user','service','delegated')),
  ADD COLUMN IF NOT EXISTS principal_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acting_as_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delegation_grant_id uuid;

CREATE INDEX IF NOT EXISTS agent_runs_principal_idx
  ON agent_runs (principal_type, principal_id);

-- Backfill legacy rows as service-unknown. No user_id column exists to
-- reconstruct per-user attribution from.
UPDATE agent_runs
  SET principal_type = 'service',
      principal_id = 'service:unknown-legacy'
  WHERE principal_id = '';
