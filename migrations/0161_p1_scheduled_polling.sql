-- migrations/0161_p1_scheduled_polling.sql
--
-- P1: Scheduled polling infrastructure for integration connectors.
-- Adds sync-tracking columns to integration_connections and creates
-- the integration_ingestion_stats table for per-sync metrics.

ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_phase text NOT NULL DEFAULT 'backfill',
  ADD COLUMN IF NOT EXISTS sync_lock_token uuid;

CREATE INDEX IF NOT EXISTS integration_connections_last_successful_sync_at_idx
  ON integration_connections (last_successful_sync_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS integration_connections_sync_phase_idx
  ON integration_connections (sync_phase)
  WHERE deleted_at IS NULL AND sync_phase IN ('backfill','transition','live');

CREATE TABLE IF NOT EXISTS integration_ingestion_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES integration_connections(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  sync_started_at timestamptz NOT NULL,
  sync_finished_at timestamptz,
  api_calls_approx int NOT NULL DEFAULT 0,
  rows_ingested int NOT NULL DEFAULT 0,
  sync_duration_ms int,
  sync_phase text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_ingestion_stats_connection_idx
  ON integration_ingestion_stats (connection_id, sync_started_at DESC);
CREATE INDEX IF NOT EXISTS integration_ingestion_stats_org_idx
  ON integration_ingestion_stats (organisation_id, created_at DESC);
