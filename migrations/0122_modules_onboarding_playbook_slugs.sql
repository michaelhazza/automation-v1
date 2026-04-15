-- Phase F — onboarding-playbooks spec §10.2 / §10.6.
--
-- Adds `modules.onboarding_playbook_slugs`: per-module list of playbook slugs
-- that should be offered (or auto-started) during onboarding for any
-- sub-account that enables the module. Stored as a Postgres text array so
-- the Onboarding tab can filter runs with `slug = ANY(...)` and the
-- `subaccountOnboardingService` can compute the union across a sub-account's
-- module set without decoding JSON.
--
-- Defaults to an empty array so existing modules remain unchanged; the
-- Phase F seeder (seedOnboardingModules.ts) populates the default
-- "reporting" module per org during the rollout.

ALTER TABLE modules
  ADD COLUMN onboarding_playbook_slugs TEXT[] NOT NULL DEFAULT '{}';

-- GIN index so we can cheaply query `slug = ANY(onboarding_playbook_slugs)`
-- or its inverse when computing the owed-list for a sub-account.
CREATE INDEX modules_onboarding_playbook_slugs_idx
  ON modules USING GIN (onboarding_playbook_slugs);

-- Duplicate onboarding run guard (spec §10.5.1). A (subaccount, slug) pair
-- may only have one active run — enforces idempotent start-now + auto-start
-- races at the DB layer. Service catches the unique violation and returns
-- the existing run, not an error.
CREATE UNIQUE INDEX playbook_runs_active_per_subaccount_slug
  ON playbook_runs (subaccount_id, playbook_slug)
  WHERE status IN ('pending', 'running', 'awaiting_input', 'awaiting_approval')
    AND playbook_slug IS NOT NULL;
