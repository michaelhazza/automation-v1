-- Time-to-usable-context per run, p50 / p95 by hour, last 7 days.
-- This is the metric that actually matters: how long until the agent can run.
-- Computed as the spread of fetched_at per run_id, requiring no schema change.
-- Runs with only one external ref will report 0; those are excluded so the
-- aggregate reflects multi-ref runs (which is where the metric matters).
SELECT
  date_trunc('hour', run_started) AS hour,
  PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM resolve_window) * 1000) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM resolve_window) * 1000) AS p95_ms,
  count(*) AS runs
FROM (
  SELECT
    run_id,
    min(fetched_at)               AS run_started,
    max(fetched_at) - min(fetched_at) AS resolve_window
  FROM document_fetch_events
  WHERE run_id IS NOT NULL
    AND fetched_at > now() - interval '7 days'
  GROUP BY run_id
  HAVING count(*) > 1
) per_run
GROUP BY hour
ORDER BY hour DESC;
