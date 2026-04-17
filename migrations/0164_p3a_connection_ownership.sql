-- migrations/0163_p3a_connection_ownership.sql
-- P3A: Add ownership, classification, and visibility columns to integration_connections.

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS ownership_scope text NOT NULL DEFAULT 'subaccount'
    CHECK (ownership_scope IN ('user','subaccount','organisation')),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'shared_mailbox'
    CHECK (classification IN ('personal','shared_mailbox','service_account')),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE integration_connections
    ADD CONSTRAINT connection_owner_consistency CHECK (
      (ownership_scope = 'user' AND owner_user_id IS NOT NULL)
      OR (ownership_scope <> 'user' AND owner_user_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS integration_connections_owner_user_id_idx
  ON integration_connections (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Backfill: column defaults handle all existing rows.
-- ownership_scope defaults to 'subaccount', classification to 'shared_mailbox',
-- visibility_scope to 'shared_subaccount', owner_user_id to NULL,
-- shared_team_ids to '{}'. No UPDATE needed.
