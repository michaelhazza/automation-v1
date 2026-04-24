-- Fix system_incident_suppressions unique index so that two global suppressions
-- (organisation_id IS NULL) for the same fingerprint are treated as a conflict.
-- PostgreSQL treats NULL != NULL in standard unique indexes, which means
-- ON CONFLICT (fingerprint, organisation_id) never fires when org_id IS NULL.
-- NULLS NOT DISTINCT (PG 15+) makes NULL == NULL for uniqueness purposes.
DROP INDEX IF EXISTS system_incident_suppressions_fp_org_unique;

CREATE UNIQUE INDEX system_incident_suppressions_fp_org_unique
  ON system_incident_suppressions (fingerprint, organisation_id)
  NULLS NOT DISTINCT;
