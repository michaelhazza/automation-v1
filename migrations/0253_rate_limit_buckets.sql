-- Sliding-window rate-limit primitive backed by Postgres.
-- Buckets are keyed on a caller-defined `key` plus a `window_start` aligned to
-- the configured window size; counts increment via UPSERT. The TTL cleanup job
-- deletes rows whose window_start is older than (now() - max_window_lookback).
--
-- This table is system-wide (no organisation_id). Keys may include user IDs,
-- IP addresses, or internal cache keys; the bucket itself does not bind to a
-- tenant. Registered in scripts/rls-not-applicable-allowlist.txt with the
-- rationale "system-wide rate-limit infrastructure; key strings opaque".

CREATE TABLE rate_limit_buckets (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Cleanup index: lets the TTL job delete-by-window_start cheaply.
CREATE INDEX rate_limit_buckets_window_start_idx
  ON rate_limit_buckets (window_start);
