-- Migration 0345: Create iee_browser_session_profiles table
--
-- Per-subaccount browser profile volumes for the IEE Browser on e2b feature.
-- One row per (organisation_id, subaccount_id, session_key). The volume persists
-- across browser sessions, allowing browser state (cookies, local storage, etc.)
-- to survive individual execution boundaries.
--
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id (Rev 2 invariant 3)

CREATE TABLE iee_browser_session_profiles (
  id                              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Tenant scoping (dual-GUC RLS columns)
  organisation_id                 UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id                   UUID         NOT NULL REFERENCES subaccounts(id) ON DELETE CASCADE,

  -- Session key: allows multiple named profiles per subaccount (default: 'default')
  session_key                     TEXT         NOT NULL DEFAULT 'default',

  -- Opaque sandbox-volume identifier (safe to log)
  volume_id                       TEXT         NOT NULL,

  -- Lifecycle tracking
  last_used_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Size tracking
  size_bytes                      BIGINT       NOT NULL DEFAULT 0,

  -- System-wide 500 MB cap
  size_cap_bytes                  BIGINT       NOT NULL DEFAULT 524288000,

  -- Profile lifecycle
  status                          TEXT         NOT NULL DEFAULT 'active',

  -- GC scheduling
  scheduled_gc_at                 TIMESTAMPTZ,
  gc_started_at                   TIMESTAMPTZ,

  -- Admin retention override (number of days)
  retention_days_override         INTEGER,

  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CHECK constraints
  CONSTRAINT iee_browser_session_profiles_status_check CHECK (
    status IN ('active', 'scheduled_gc', 'gc_in_progress', 'gc_done')
  )
);

-- UNIQUE: at most one profile per (organisation, subaccount, session_key)
CREATE UNIQUE INDEX iee_browser_session_profiles_tenant_key_unique_idx ON iee_browser_session_profiles (organisation_id, subaccount_id, session_key);

-- Index for GC scheduling queries by last activity
CREATE INDEX iee_browser_session_profiles_last_used_at_idx ON iee_browser_session_profiles (last_used_at);

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id (Rev 2 invariant 3)
ALTER TABLE iee_browser_session_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_browser_session_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY iee_browser_session_profiles_org_subaccount_isolation ON iee_browser_session_profiles
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND current_setting('app.subaccount_id', true) IS NOT NULL
    AND current_setting('app.subaccount_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
    AND subaccount_id = current_setting('app.subaccount_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND current_setting('app.subaccount_id', true) IS NOT NULL
    AND current_setting('app.subaccount_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
    AND subaccount_id = current_setting('app.subaccount_id', true)::uuid
  );
