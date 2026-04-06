-- Migration 0056: Rolling aggregates table for job queue health dashboard (A2)
-- Write-time aggregation in 5-minute buckets avoids scanning raw pg-boss tables.

CREATE TABLE job_queue_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  UNIQUE(queue, window_start)
);

CREATE INDEX idx_job_queue_stats_queue_window
  ON job_queue_stats (queue, window_start DESC);
