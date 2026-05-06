ALTER TABLE connector_configs
  DROP COLUMN IF EXISTS first_qualifying_poll_at,
  DROP COLUMN IF EXISTS successful_poll_count_total;
DROP INDEX IF EXISTS subaccount_baselines_pending_retry_idx;
DROP INDEX IF EXISTS subaccount_baselines_status_idx;
DROP INDEX IF EXISTS subaccount_baselines_active_uniq;
DROP TABLE IF EXISTS subaccount_baselines;
