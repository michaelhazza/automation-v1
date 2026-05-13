-- Migration 0347: Create subaccount_iee_browser_settings table
--
-- Per-subaccount IEE browser configuration. One row per subaccount
-- (PRIMARY KEY subaccount_id). Created lazily on first write; absent row
-- means use column defaults. Sibling to subaccount_operator_settings.
--
-- IMPORTANT: status MUST default to 'off' — brief §3.5 v7 invariant ("no
-- mass enable on backfill"). Any migration that changes this default is a
-- security regression.
--
-- settings_version is the deterministic ETag source. ETag = String(settings_version).
-- Every PATCH must use settings_version = settings_version + 1.
--
-- RLS: dual-GUC policy on BOTH app.organisation_id AND app.subaccount_id

CREATE TABLE subaccount_iee_browser_settings (
  subaccount_id                          UUID         NOT NULL PRIMARY KEY REFERENCES subaccounts(id) ON DELETE CASCADE,
  organisation_id                        UUID         NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  status                                 TEXT         NOT NULL DEFAULT 'off',
  rollout_approved                       BOOLEAN      NOT NULL DEFAULT false,
  browser_profile_retention_days         INTEGER      NOT NULL DEFAULT 30,
  per_task_cost_ceiling_cents            INTEGER      NOT NULL DEFAULT 100,
  per_subaccount_daily_cost_ceiling_cents INTEGER     NOT NULL DEFAULT 500,
  settings_version                       INTEGER      NOT NULL DEFAULT 1,
  updated_at                             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by_user_id                     UUID         REFERENCES users(id),

  CONSTRAINT sibs_status_check CHECK (status IN ('on', 'off')),
  CONSTRAINT sibs_browser_profile_retention_days_check CHECK (browser_profile_retention_days BETWEEN 7 AND 90),
  CONSTRAINT sibs_per_task_cost_ceiling_cents_check CHECK (per_task_cost_ceiling_cents BETWEEN 1 AND 10000),
  CONSTRAINT sibs_per_subaccount_daily_cost_ceiling_cents_check CHECK (per_subaccount_daily_cost_ceiling_cents BETWEEN 1 AND 100000),
  CONSTRAINT sibs_settings_version_positive CHECK (settings_version >= 1)
);

-- RLS: dual-GUC scoping on both organisation_id AND subaccount_id
ALTER TABLE subaccount_iee_browser_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subaccount_iee_browser_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY subaccount_iee_browser_settings_org_subaccount_isolation ON subaccount_iee_browser_settings
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
