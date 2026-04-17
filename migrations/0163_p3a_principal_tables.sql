-- migrations/0162_p3a_principal_tables.sql
-- P3A: Principal model tables — service principals, teams, delegation grants,
-- and the canonical row subaccount scoping junction table.

CREATE TABLE IF NOT EXISTS service_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,
  service_id text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (organisation_id, service_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_org_idx ON team_members (organisation_id);

CREATE TABLE IF NOT EXISTS delegation_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  grantor_user_id uuid NOT NULL REFERENCES users(id),
  grantee_kind text NOT NULL CHECK (grantee_kind IN ('user','service')),
  grantee_id text NOT NULL,
  subaccount_id uuid,
  allowed_canonical_tables text[] NOT NULL,
  allowed_actions text[] NOT NULL,
  reason text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delegation_grants_org_idx ON delegation_grants (organisation_id);
CREATE UNIQUE INDEX IF NOT EXISTS delegation_grants_active_idx
  ON delegation_grants (grantor_user_id, grantee_kind, grantee_id, subaccount_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS canonical_row_subaccount_scopes (
  canonical_table text NOT NULL,
  canonical_row_id uuid NOT NULL,
  subaccount_id uuid NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  attribution text NOT NULL CHECK (attribution IN ('primary','mentioned','shared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_table, canonical_row_id, subaccount_id)
);

CREATE INDEX IF NOT EXISTS canonical_row_subaccount_scopes_sub_idx
  ON canonical_row_subaccount_scopes (subaccount_id, canonical_table);
CREATE INDEX IF NOT EXISTS canonical_row_subaccount_scopes_org_idx
  ON canonical_row_subaccount_scopes (organisation_id);
