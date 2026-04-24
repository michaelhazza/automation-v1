-- 0182_organisations_onboarding_completed_at.sql — rollback

BEGIN;

ALTER TABLE organisations
  DROP COLUMN IF EXISTS onboarding_completed_at;

COMMIT;
