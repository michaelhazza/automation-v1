# External document reference observability queries

Run via `psql $DATABASE_URL -f <file>` or import into Grafana as a Postgres data source.

| Query | Purpose | Cadence |
|---|---|---|
| `success_rate_per_provider_last_24h.sql` | Provider-level health check; alarm if <95% sustained | hourly |
| `cache_hit_ratio_per_subaccount_last_24h.sql` | Cache effectiveness per tenant; investigate <50% on high-traffic subaccounts | daily |
| `failures_grouped_by_reason_last_7d.sql` | Incident-scale view; spot trends in `auth_revoked` / `rate_limited` | on-incident |
| `time_to_usable_context_p50_p95.sql` | The metric that matters: how long until the agent can run. p50/p95 per hour over 7 days. | hourly |

Per-event latency aggregation deferred to v1.1 (requires `document_fetch_events.duration_ms` column).
