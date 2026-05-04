-- system-scoped: cross-tenant aggregate over agent_execution_events; no per-tenant rows in projection

CREATE MATERIALIZED VIEW optimiser_skill_peer_medians AS
SELECT
  payload->>'skillSlug' AS skill_slug,
  percentile_cont(0.50) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (
    ORDER BY (payload->>'durationMs')::numeric
  ) AS p99_ms,
  count(distinct organisation_id) AS n_tenants,
  1::int AS median_version,
  now() AS refreshed_at
FROM agent_execution_events
WHERE event_type = 'skill.completed'
  AND event_timestamp >= now() - interval '7 days'
  AND payload ? 'skillSlug'
  AND payload ? 'durationMs'
GROUP BY skill_slug
HAVING count(distinct organisation_id) >= 5;

CREATE UNIQUE INDEX optimiser_skill_peer_medians_pk ON optimiser_skill_peer_medians (skill_slug);

-- Revoke public access; grant to admin_role only
REVOKE ALL ON optimiser_skill_peer_medians FROM PUBLIC;
GRANT SELECT ON optimiser_skill_peer_medians TO admin_role;

-- Seed system_agents row for the sub-account optimiser
-- (mirror migrations/0068_portfolio_health_agent_seed.sql pattern)
INSERT INTO system_agents (
  id, slug, name, description, execution_scope, agent_role, agent_title,
  master_prompt, execution_mode,
  heartbeat_enabled, heartbeat_interval_hours,
  default_token_budget, default_max_tool_calls,
  is_published, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'subaccount-optimiser',
  'Subaccount Optimiser',
  'Scans subaccount telemetry across 8 categories and surfaces operator-facing recommendations to the dashboard.',
  'subaccount',
  'analyst',
  'Subaccount Optimiser',
  'You are the Subaccount Optimiser. Your responsibility is to scan telemetry for this subaccount and surface actionable recommendations.

On each scheduled scan:
1. Run the 8 telemetry scan skills to collect metric evidence
2. Evaluate each metric against thresholds and peer baselines
3. Surface findings via the output.recommend skill
4. Skip categories where data is unavailable (partial mode)

Focus on actionable findings. Emit one recommendation per distinct finding. Do not include internal category slugs in operator-visible copy.',
  'api',
  false,
  0,
  50000,
  30,
  true,
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- Initial population (will return 0 rows on fresh dev DB; that is expected)
REFRESH MATERIALIZED VIEW optimiser_skill_peer_medians;
