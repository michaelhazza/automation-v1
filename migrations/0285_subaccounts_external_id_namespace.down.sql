DROP INDEX IF EXISTS subaccounts_org_external_ghl_location_idx;
ALTER TABLE subaccounts DROP COLUMN IF EXISTS external_id_namespace;
