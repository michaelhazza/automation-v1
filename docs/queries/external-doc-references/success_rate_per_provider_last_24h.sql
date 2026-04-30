-- Success rate per provider over the last 24 hours.
-- Run: psql $DATABASE_URL -f success_rate_per_provider_last_24h.sql
SELECT
  provider,
  count(*) AS total,
  count(*) FILTER (WHERE failure_reason IS NULL) AS successes,
  ROUND(
    count(*) FILTER (WHERE failure_reason IS NULL)::numeric / NULLIF(count(*), 0) * 100,
    2
  ) AS success_pct
FROM document_fetch_events
WHERE fetched_at > now() - interval '24 hours'
GROUP BY provider
ORDER BY total DESC;
