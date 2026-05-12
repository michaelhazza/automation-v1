-- Migration 0329: Create subaccount_operator_settings table
--
-- Per-subaccount configuration for the operator backend (runtime caps).
-- One row per subaccount (PRIMARY KEY subaccount_id). Created lazily on first
-- write; absent row means use column defaults.
--
-- R2-F3: settings_version is the deterministic ETag source (integer; NOT
-- timestamp-based). ETag = String(settings_version). Every PATCH must use
-- settings_version = settings_version + 1 (not a clock value).
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.16
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id (Rev 2 invariant 3)

CREATE TABLE subaccount_operator_settings (
  -- Primary key is the subaccount (one row per subaccount)
  subaccount_id                    UUID         NOT NULL PRIMARY KEY REFERENCES subaccounts(id) ON DELETE CASCADE,

  -- Defence-in-depth tenant scope for RLS
  organisation_id                  UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,

  -- Session limits (spec §3.16)
  session_soft_cap_minutes         INTEGER      NOT NULL DEFAULT 120,
  auto_extend_grace_minutes        INTEGER      NOT NULL DEFAULT 30,

  -- Task limits (spec §3.16)
  max_chain_length                 INTEGER      NOT NULL DEFAULT 50,
  max_wall_clock_per_task_days     INTEGER      NOT NULL DEFAULT 30,
  per_task_budget_cap_minutes      INTEGER      NOT NULL DEFAULT 6000,

  -- Concurrency limit (spec §3.16)
  concurrent_operator_sessions_cap INTEGER      NOT NULL DEFAULT 5,

  -- Deterministic ETag source (R2-F3). ETag = String(settings_version).
  -- Incremented via settings_version = settings_version + 1 on every PATCH.
  settings_version                 INTEGER      NOT NULL DEFAULT 1,

  -- Audit
  updated_at                       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by_user_id               UUID         REFERENCES users(id),

  -- CHECK constraints (spec §3.16 min/max bounds)
  CONSTRAINT sos_session_soft_cap_minutes_check CHECK (
    session_soft_cap_minutes BETWEEN 30 AND 240
  ),
  CONSTRAINT sos_auto_extend_grace_minutes_check CHECK (
    auto_extend_grace_minutes BETWEEN 0 AND 60
  ),
  CONSTRAINT sos_max_chain_length_check CHECK (
    max_chain_length BETWEEN 1 AND 500
  ),
  CONSTRAINT sos_max_wall_clock_per_task_days_check CHECK (
    max_wall_clock_per_task_days BETWEEN 1 AND 365
  ),
  CONSTRAINT sos_per_task_budget_cap_minutes_check CHECK (
    per_task_budget_cap_minutes BETWEEN 60 AND 60000
  ),
  CONSTRAINT sos_concurrent_operator_sessions_cap_check CHECK (
    concurrent_operator_sessions_cap BETWEEN 1 AND 25
  ),
  CONSTRAINT sos_settings_version_positive CHECK (settings_version >= 1)
);

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id (Rev 2 invariant 3)
ALTER TABLE subaccount_operator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_operator_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY subaccount_operator_settings_org_subaccount_isolation ON subaccount_operator_settings
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
