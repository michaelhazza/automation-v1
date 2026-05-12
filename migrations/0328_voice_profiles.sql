-- voice_profiles: persistent voice profile storage with three-axis scoping
-- (owner_user_id-scoped | subaccount_id-scoped | org_scope = true)

CREATE TABLE IF NOT EXISTS voice_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  owner_user_id      uuid REFERENCES users(id) ON DELETE RESTRICT,
  subaccount_id      uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
  org_scope          boolean NOT NULL DEFAULT false,
  sources            text[] NOT NULL DEFAULT '{}',
  sample_count       integer NOT NULL DEFAULT 0,
  profile_json       jsonb,
  state              text NOT NULL DEFAULT 'pending',
  refresh_policy     text NOT NULL DEFAULT 'manual',
  last_refreshed_at  timestamptz,
  opted_out_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Exactly one scope axis must be set
  CONSTRAINT voice_profiles_scope_check CHECK (
    ((owner_user_id IS NOT NULL)::int + (subaccount_id IS NOT NULL)::int + (org_scope)::int) = 1
  ),
  CONSTRAINT voice_profiles_state_check CHECK (
    state IN ('pending', 'deriving', 'ready', 'failed')
  ),
  CONSTRAINT voice_profiles_refresh_policy_check CHECK (
    refresh_policy IN ('manual', 'periodic', 'on_send_count')
  )
);

ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY voice_profiles_isolation ON voice_profiles
  USING (
    (owner_user_id IS NOT NULL AND owner_user_id = current_setting('app.current_user_id', true)::uuid)
    OR (subaccount_id IS NOT NULL AND subaccount_id = ANY(string_to_array(current_setting('app.current_subaccount_ids', true), ',')::uuid[]))
    OR (org_scope = true AND organisation_id = current_setting('app.organisation_id', true)::uuid)
    OR (current_setting('app.current_role', true) IN ('org_admin', 'subaccount_admin'))
  )
  WITH CHECK (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- Partial indexes for each scope axis
CREATE INDEX IF NOT EXISTS voice_profiles_owner_idx
  ON voice_profiles(organisation_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS voice_profiles_subaccount_idx
  ON voice_profiles(organisation_id, subaccount_id)
  WHERE subaccount_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS voice_profiles_state_refresh_idx
  ON voice_profiles(state, last_refreshed_at)
  WHERE state IN ('ready', 'pending') AND opted_out_at IS NULL;
