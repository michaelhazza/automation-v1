-- Migration 0315: Add CHECK constraint on integration_connections.connection_status
-- Preflight: abort if any row carries an out-of-enum value.
DO $$
DECLARE
  bad_count integer;
  sample text[];
BEGIN
  SELECT count(*), array_agg(DISTINCT connection_status)
    INTO bad_count, sample
    FROM integration_connections
   WHERE connection_status NOT IN ('active','revoked','error');
  IF bad_count > 0 THEN
    RAISE EXCEPTION '0315 preflight failed: % rows have invalid connection_status. Sample: %. Aborting; clean up before re-running.', bad_count, sample;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'integration_connections_connection_status_check'
  ) THEN
    ALTER TABLE integration_connections
      ADD CONSTRAINT integration_connections_connection_status_check
      CHECK (connection_status IN ('active','revoked','error'));
  END IF;
END $$;
