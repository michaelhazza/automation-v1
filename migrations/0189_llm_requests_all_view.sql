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

COMMIT;
