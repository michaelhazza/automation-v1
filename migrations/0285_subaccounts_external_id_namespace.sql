-- Add external_id_namespace column and partial unique index for GHL location idempotency
-- Phase 3 D.5 — ghlAutoEnrolLocationsPageJob schema

ALTER TABLE subaccounts ADD COLUMN external_id_namespace text;

-- Backfill: set 'ghl_location' for rows already enrolled via GHL.
-- Join through connector_configs WHERE connector_type = 'ghl' to identify GHL-enrolled rows.
UPDATE subaccounts
SET external_id_namespace = 'ghl_location'
WHERE external_id IS NOT NULL
  AND connector_config_id IS NOT NULL
  AND connector_config_id IN (
    SELECT id FROM connector_configs WHERE connector_type = 'ghl'
  );

-- Backfill safety check — must appear AFTER the UPDATE
DO $$
DECLARE remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
    FROM subaccounts
   WHERE external_id IS NOT NULL AND external_id_namespace IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % rows still have external_id_namespace = NULL', remaining;
  END IF;
END $$;

-- Partial unique index — enforces idempotency per GHL location, soft-delete aware
CREATE UNIQUE INDEX subaccounts_org_external_ghl_location_idx
  ON subaccounts (organisation_id, external_id)
  WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL;
