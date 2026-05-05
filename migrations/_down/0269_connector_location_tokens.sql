DROP POLICY IF EXISTS connector_location_tokens_org_isolation ON connector_location_tokens;
DROP INDEX IF EXISTS connector_location_tokens_expires_idx;
DROP INDEX IF EXISTS connector_location_tokens_live_uniq;
DROP TABLE IF EXISTS connector_location_tokens;
