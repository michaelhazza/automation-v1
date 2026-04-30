-- Cache hit ratio per subaccount over the last 24 hours.
-- A low ratio on a high-traffic subaccount usually means revisions are flipping
-- frequently (operators editing the source doc) or the resolver_version was bumped.
SELECT
  subaccount_id,
  count(*) AS total,
  count(*) FILTER (WHERE cache_hit) AS cache_hits,
  ROUND(
    count(*) FILTER (WHERE cache_hit)::numeric / NULLIF(count(*), 0) * 100,
    2
  ) AS cache_hit_pct
FROM document_fetch_events
WHERE fetched_at > now() - interval '24 hours'
GROUP BY subaccount_id
ORDER BY total DESC;
