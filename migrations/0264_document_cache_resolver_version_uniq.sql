-- 0264_document_cache_resolver_version_uniq.sql
-- Finding 1: adds resolver_version to document_cache unique key so each resolver
-- version owns its own row. Prevents a v1 worker from overwriting a v2 row
-- during rolling deployments (the prior UNIQUE lacked resolver_version, so
-- onConflictDoUpdate could silently overwrite content from a newer version).
--
-- Finding 4: adds fetched_at index on document_fetch_events for analytics
-- queries that filter on fetched_at > now() - interval '24 hours'.

BEGIN;

DROP INDEX IF EXISTS document_cache_provider_file_connection_uniq;
CREATE UNIQUE INDEX document_cache_provider_file_conn_version_uniq
  ON document_cache (provider, file_id, connection_id, resolver_version);

CREATE INDEX IF NOT EXISTS document_fetch_events_fetched_at_idx
  ON document_fetch_events (fetched_at);

COMMIT;
