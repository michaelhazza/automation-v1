-- Failures grouped by reason over the last 7 days, with blast radius.
-- subaccounts_affected = how many tenants saw this failure mode.
-- refs_affected = how many distinct references hit it (proxy for incident scale).
SELECT
  failure_reason,
  count(*) AS occurrences,
  count(DISTINCT subaccount_id) AS subaccounts_affected,
  count(DISTINCT reference_id) AS refs_affected
FROM document_fetch_events
WHERE fetched_at > now() - interval '7 days'
  AND failure_reason IS NOT NULL
GROUP BY failure_reason
ORDER BY occurrences DESC;
