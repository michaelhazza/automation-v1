-- Migration 0189 — llm_requests_all view (union live + archive)
--
-- Spec §11 / §12.4: P&L queries must cover any month in the reporting
-- window, regardless of which rows have been moved into the archive by
-- the nightly retention job. Without this view, queries like
-- platformTotals(), getByOrganisation(), getBySourceType(), etc. silently
-- underreport any period that crosses the retention boundary (default
-- 12 months) — pr-review-log-llm-observability-20260420T104905Z.md B5.
--
-- The view exposes every column shared by llm_requests and
-- llm_requests_archive. The archive has one extra column (archived_at)
-- which is intentionally omitted — callers that need it should query
-- the archive directly.
--
-- SECURITY INVOKER is not the default in PG 14+; set explicitly so RLS
-- on the underlying tables is enforced against the caller's role, not
-- the view owner. System P&L reads already go through adminRead +
-- SET LOCAL ROLE admin_role (BYPASSRLS), so for that caller the view
-- is effectively a plain union. For any future non-admin caller, the
-- underlying RLS policies enforce tenant isolation naturally.
--
-- GRANTs at the end of the file: admin_role was declared BYPASSRLS in
-- 0079 but never given table-level privileges. Once a caller does
-- `SET LOCAL ROLE admin_role`, Postgres evaluates SELECT against
-- admin_role itself — which has none by default — and the query fails
-- with "permission denied". Migration 0169 established the precedent:
-- before switching role, grant the minimum SELECT admin-bypass needs.
-- The System P&L service (server/services/systemPnlService.ts) reads
-- seven relations — the view added here + the six it joins against —
-- so every one needs an explicit grant. Without these the entire
-- `/api/admin/llm-pnl/*` surface returns 500.

BEGIN;

CREATE OR REPLACE VIEW llm_requests_all
  WITH (security_invoker = on) AS
SELECT
  id, idempotency_key, organisation_id, subaccount_id, user_id,
  source_type, run_id, execution_id, iee_run_id, source_id,
  feature_tag, call_site, agent_name, task_type,
  provider, model, provider_request_id,
  tokens_in, tokens_out, provider_tokens_in, provider_tokens_out,
  cost_raw, cost_with_margin, cost_with_margin_cents, margin_multiplier, fixed_fee_cents,
  request_payload_hash, response_payload_hash,
  provider_latency_ms, router_overhead_ms,
  status, error_message, attempt_number,
  parse_failure_raw_excerpt, abort_reason,
  cached_prompt_tokens,
  execution_phase, capability_tier, was_downgraded, routing_reason,
  was_escalated, escalation_reason,
  requested_provider, requested_model, fallback_chain,
  billing_month, billing_day, created_at
FROM llm_requests
UNION ALL
SELECT
  id, idempotency_key, organisation_id, subaccount_id, user_id,
  source_type, run_id, execution_id, iee_run_id, source_id,
  feature_tag, call_site, agent_name, task_type,
  provider, model, provider_request_id,
  tokens_in, tokens_out, provider_tokens_in, provider_tokens_out,
  cost_raw, cost_with_margin, cost_with_margin_cents, margin_multiplier, fixed_fee_cents,
  request_payload_hash, response_payload_hash,
  provider_latency_ms, router_overhead_ms,
  status, error_message, attempt_number,
  parse_failure_raw_excerpt, abort_reason,
  cached_prompt_tokens,
  execution_phase, capability_tier, was_downgraded, routing_reason,
  was_escalated, escalation_reason,
  requested_provider, requested_model, fallback_chain,
  billing_month, billing_day, created_at
FROM llm_requests_archive;

-- SELECT grants for the admin-bypass path. Every relation below is read
-- by `systemPnlService` under `SET LOCAL ROLE admin_role` (adminRead).
-- Kept together so the P&L read-path contract lives in one place.
GRANT SELECT ON llm_requests_all     TO admin_role;
GRANT SELECT ON llm_requests         TO admin_role;
GRANT SELECT ON llm_requests_archive TO admin_role;
GRANT SELECT ON cost_aggregates      TO admin_role;
GRANT SELECT ON organisations        TO admin_role;
GRANT SELECT ON subaccounts          TO admin_role;
GRANT SELECT ON org_margin_configs   TO admin_role;

COMMIT;
