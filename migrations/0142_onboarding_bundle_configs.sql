-- Migration 0142 — onboarding_bundle_configs
--
-- Per-org bundle configuration for the onboarding flow (§8.7). One row per
-- organisation. `playbookSlugs` is the ordered list that onboarding autostarts.
-- Default: [intelligence-briefing, weekly-digest].
--
-- Spec: docs/memory-and-briefings-spec.md §8.7 (S5)

CREATE TABLE IF NOT EXISTS onboarding_bundle_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL UNIQUE
    REFERENCES organisations(id),
  playbook_slugs jsonb NOT NULL DEFAULT '["intelligence-briefing","weekly-digest"]'::jsonb,
  ordering jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid
);

CREATE INDEX IF NOT EXISTS onboarding_bundle_configs_org_idx
  ON onboarding_bundle_configs (organisation_id);

-- RLS
ALTER TABLE onboarding_bundle_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_bundle_configs_tenant_isolation ON onboarding_bundle_configs;
CREATE POLICY onboarding_bundle_configs_tenant_isolation ON onboarding_bundle_configs
  USING (organisation_id::text = current_setting('app.organisation_id', true));
