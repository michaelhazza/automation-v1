-- 0182_organisations_onboarding_completed_at.sql
-- Session 1 / Chunk A.1 — onboarding gate column.
--
-- Per spec §7.5 (tasks/builds/clientpulse/session-1-foundation-spec.md): the
-- new org-admin onboarding wizard uses organisations.onboarding_completed_at
-- as its sole "should the wizard auto-open?" gate. The existing derivation
-- fields (ghlConnected, agentsProvisioned, firstRunComplete) exposed by
-- onboardingService.getOnboardingStatus remain independent of this column and
-- continue to drive the sync-progress screen + dashboard empty states.
--
-- Pre-existing orgs are marked onboarded at their created_at timestamp so the
-- wizard does not retroactively auto-open for orgs that already completed the
-- old onboarding flow.

BEGIN;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

-- Backfill: every existing org is marked onboarded by default.
UPDATE organisations
SET onboarding_completed_at = created_at
WHERE onboarding_completed_at IS NULL;

COMMIT;
